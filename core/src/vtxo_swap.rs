//! VTXO Swap operations for BTC-to-BTC (Arkade refresh) swaps.
//!
//! This module provides functionality for:
//! - Claiming the server's VHTLC (after server funds)
//! - Refunding the client's VHTLC (if swap fails)

use crate::SwapParams;
use crate::api::VtxoSwapResponse;
use crate::error::{Error, Result};
use crate::types::Network;
use ark_rs::core::VTXO_CONDITION_KEY;
use ark_rs::core::send::{
    OffchainTransactions, VtxoInput, build_offchain_transactions, sign_ark_transaction,
    sign_checkpoint_transaction,
};
use ark_rs::core::server::{GetVtxosRequest, parse_sequence_number};
use ark_rs::core::vhtlc::{VhtlcOptions, VhtlcScript};
use ark_rs::core::{ArkAddress, VtxoList};
use bitcoin::absolute::LockTime;
use bitcoin::consensus::Encodable;
use bitcoin::hashes::Hash;
use bitcoin::key::{Keypair, Secp256k1};
use bitcoin::secp256k1::schnorr;
use bitcoin::taproot::LeafVersion;
use bitcoin::{Amount, PublicKey, Txid, VarInt, XOnlyPublicKey, psbt, secp256k1};

/// Claim the server's VHTLC in a VTXO swap.
///
/// In a VTXO swap, the client claims the server's VHTLC by revealing the preimage.
/// The server is the sender and the client is the receiver.
pub async fn claim_server_vhtlc(
    ark_server_url: &str,
    claim_ark_address: ArkAddress,
    swap: &VtxoSwapResponse,
    swap_params: SwapParams,
    network: Network,
) -> Result<Txid> {
    let secp = Secp256k1::new();
    let bitcoin_network = network.to_bitcoin_network();

    let secret_key = swap_params.secret_key;
    let own_kp = Keypair::from_secret_key(&secp, &secret_key);
    let own_pk = own_kp.public_key();

    // Parse preimage
    let preimage = swap_params.preimage;

    // Hash the preimage for VHTLC construction (SHA256 -> RIPEMD160)
    let sha256_hash = bitcoin::hashes::sha256::Hash::hash(&preimage);
    let ripemd160_hash = bitcoin::hashes::ripemd160::Hash::hash(&sha256_hash.to_byte_array());

    // Parse public keys
    // Server VHTLC: server is sender, client is receiver
    let server_pk = parse_public_key(&swap.server_pk)?;
    let arkade_server_pk = parse_public_key(&swap.arkade_server_pk)?;

    let vhtlc = VhtlcScript::new(
        VhtlcOptions {
            sender: server_pk.into(),
            receiver: own_pk.into(),
            server: arkade_server_pk.into(),
            preimage_hash: ripemd160_hash,
            refund_locktime: swap.server_locktime as u32,
            unilateral_claim_delay: parse_sequence_number(swap.server_unilateral_claim_delay)
                .map_err(|e| Error::Vhtlc(format!("Invalid unilateral claim delay: {}", e)))?,
            unilateral_refund_delay: parse_sequence_number(swap.server_unilateral_refund_delay)
                .map_err(|e| Error::Vhtlc(format!("Invalid unilateral refund delay: {}", e)))?,
            unilateral_refund_without_receiver_delay: parse_sequence_number(
                swap.server_unilateral_refund_without_receiver_delay,
            )
            .map_err(|e| {
                Error::Vhtlc(format!(
                    "Invalid unilateral refund without receiver delay: {}",
                    e
                ))
            })?,
        },
        bitcoin_network,
    )
    .map_err(|e| Error::Vhtlc(format!("Failed to construct VHTLC script: {}", e)))?;

    let vhtlc_address = vhtlc.address();

    // Verify address matches
    if vhtlc_address.encode() != swap.server_vhtlc_address {
        return Err(Error::Vhtlc(format!(
            "Server VHTLC address ({}) does not match swap address ({})",
            vhtlc_address.encode(),
            swap.server_vhtlc_address
        )));
    }

    // Connect to Arkade server
    let rest_client = ark_rest::Client::new(ark_server_url.to_string());
    let server_info = rest_client
        .get_info()
        .await
        .map_err(|e| Error::Arkade(format!("Failed to get server info: {}", e)))?;

    // Fetch VTXOs
    let request = GetVtxosRequest::new_for_addresses(std::iter::once(vhtlc_address));
    let virtual_tx_outpoints = rest_client
        .list_vtxos(request)
        .await
        .map_err(|e| Error::Arkade(format!("Failed to fetch VTXOs: {}", e)))?;
    let vtxo_list = VtxoList::new(server_info.dust, virtual_tx_outpoints);

    let spend_info = vhtlc.taproot_spend_info();
    let script_ver = (vhtlc.claim_script(), LeafVersion::TapScript);
    let control_block = spend_info
        .control_block(&script_ver)
        .ok_or_else(|| Error::Vhtlc("Missing control block".into()))?;

    let total_amount = vtxo_list
        .spendable_offchain()
        .fold(Amount::ZERO, |acc, x| acc + x.amount);

    if total_amount == Amount::ZERO {
        return Err(Error::Vhtlc(
            "No spendable VTXOs found in server's VHTLC".into(),
        ));
    }

    let script_pubkey = vhtlc.script_pubkey();
    let tapscripts = vhtlc.tapscripts();

    let vhtlc_inputs: Vec<VtxoInput> = vtxo_list
        .spendable_offchain()
        .map(|v| {
            VtxoInput::new(
                script_ver.0.clone(),
                None,
                control_block.clone(),
                tapscripts.clone(),
                script_pubkey.clone(),
                v.amount,
                v.outpoint,
            )
        })
        .collect();

    let outputs = vec![(&claim_ark_address, total_amount)];

    let OffchainTransactions {
        mut ark_tx,
        checkpoint_txs,
    } = build_offchain_transactions(&outputs, None, &vhtlc_inputs, &server_info)
        .map_err(|e| Error::Vhtlc(format!("Failed to build offchain TXs: {}", e)))?;

    // Sign function that adds preimage witness
    let sign_fn = |input: &mut psbt::Input,
                   msg: secp256k1::Message|
     -> std::result::Result<
        Vec<(schnorr::Signature, XOnlyPublicKey)>,
        ark_rs::core::Error,
    > {
        // Add preimage to PSBT input
        {
            let mut bytes = vec![1]; // One witness element
            let length = VarInt::from(preimage.len() as u64);
            length
                .consensus_encode(&mut bytes)
                .expect("valid length encoding");
            bytes.extend_from_slice(&preimage);

            input.unknown.insert(
                psbt::raw::Key {
                    type_value: 222,
                    key: VTXO_CONDITION_KEY.to_vec(),
                },
                bytes,
            );
        }

        let sig = Secp256k1::new().sign_schnorr_no_aux_rand(&msg, &own_kp);
        let pk = own_kp.public_key().into();

        Ok(vec![(sig, pk)])
    };

    sign_ark_transaction(sign_fn, &mut ark_tx, 0)
        .map_err(|e| Error::Vhtlc(format!("Failed to sign ark transaction: {}", e)))?;

    let ark_txid = ark_tx.unsigned_tx.compute_txid();

    let res = rest_client
        .submit_offchain_transaction_request(ark_tx, checkpoint_txs)
        .await
        .map_err(|e| Error::Arkade(format!("Failed to submit offchain TXs: {:?}", e)))?;

    let mut checkpoint_psbts = res.signed_checkpoint_txs;
    for checkpoint_psbt in checkpoint_psbts.iter_mut() {
        sign_checkpoint_transaction(sign_fn, checkpoint_psbt)
            .map_err(|e| Error::Vhtlc(format!("Failed to sign checkpoint TX: {}", e)))?;
    }

    rest_client
        .finalize_offchain_transaction(ark_txid, checkpoint_psbts)
        .await
        .map_err(|e| Error::Arkade(format!("Failed to finalize transaction: {}", e)))?;

    log::info!(
        "Claimed server's VHTLC in VTXO swap with transaction {}",
        ark_txid
    );

    Ok(ark_txid)
}

/// Refund the client's VHTLC in a VTXO swap.
///
/// In a VTXO swap, the client can refund their own VHTLC after the locktime expires.
/// The client is the sender and the server is the receiver.
pub async fn refund_client_vhtlc(
    ark_server_url: &str,
    refund_ark_address: ArkAddress,
    swap: &VtxoSwapResponse,
    swap_params: SwapParams,
    network: Network,
) -> Result<Txid> {
    let secp = Secp256k1::new();
    let bitcoin_network = network.to_bitcoin_network();

    let secret_key = swap_params.secret_key;
    let own_kp = Keypair::from_secret_key(&secp, &secret_key);
    let own_pk = own_kp.public_key();

    // Parse preimage for hash computation
    let preimage_bytes = swap_params.preimage;

    // Hash the preimage for VHTLC construction (SHA256 -> RIPEMD160)
    let sha256_hash = bitcoin::hashes::sha256::Hash::hash(&preimage_bytes);
    let ripemd160_hash = bitcoin::hashes::ripemd160::Hash::hash(&sha256_hash.to_byte_array());

    // Parse public keys
    // Client VHTLC: client is sender, server is receiver
    let server_pk = parse_public_key(&swap.server_pk)?;
    let arkade_server_pk = parse_public_key(&swap.arkade_server_pk)?;

    let vhtlc = VhtlcScript::new(
        VhtlcOptions {
            sender: own_pk.into(),
            receiver: server_pk.into(),
            server: arkade_server_pk.into(),
            preimage_hash: ripemd160_hash,
            refund_locktime: swap.client_locktime as u32,
            unilateral_claim_delay: parse_sequence_number(swap.client_unilateral_claim_delay)
                .map_err(|e| Error::Vhtlc(format!("Invalid unilateral claim delay: {}", e)))?,
            unilateral_refund_delay: parse_sequence_number(swap.client_unilateral_refund_delay)
                .map_err(|e| Error::Vhtlc(format!("Invalid unilateral refund delay: {}", e)))?,
            unilateral_refund_without_receiver_delay: parse_sequence_number(
                swap.client_unilateral_refund_without_receiver_delay,
            )
            .map_err(|e| {
                Error::Vhtlc(format!(
                    "Invalid unilateral refund without receiver delay: {}",
                    e
                ))
            })?,
        },
        bitcoin_network,
    )
    .map_err(|e| Error::Vhtlc(format!("Failed to construct VHTLC script: {}", e)))?;

    let vhtlc_address = vhtlc.address();

    // Verify address matches
    if vhtlc_address.encode() != swap.client_vhtlc_address {
        return Err(Error::Vhtlc(format!(
            "Client VHTLC address ({}) does not match swap address ({})",
            vhtlc_address.encode(),
            swap.client_vhtlc_address
        )));
    }

    // Connect to Arkade server
    let rest_client = ark_rest::Client::new(ark_server_url.to_string());
    let server_info = rest_client
        .get_info()
        .await
        .map_err(|e| Error::Arkade(format!("Failed to get server info: {}", e)))?;

    // Fetch VTXOs
    let request = GetVtxosRequest::new_for_addresses(std::iter::once(vhtlc_address));
    let virtual_tx_outpoints = rest_client
        .list_vtxos(request)
        .await
        .map_err(|e| Error::Arkade(format!("Failed to fetch VTXOs: {}", e)))?;
    let vtxo_list = VtxoList::new(server_info.dust, virtual_tx_outpoints);

    let spend_info = vhtlc.taproot_spend_info();
    let script_ver = (
        vhtlc.refund_without_receiver_script(),
        LeafVersion::TapScript,
    );
    let control_block = spend_info
        .control_block(&script_ver)
        .ok_or_else(|| Error::Vhtlc("Missing control block".into()))?;

    let total_amount = vtxo_list
        .spendable_offchain()
        .fold(Amount::ZERO, |acc, x| acc + x.amount);

    if total_amount == Amount::ZERO {
        return Err(Error::Vhtlc(
            "No spendable VTXOs found in client's VHTLC".into(),
        ));
    }

    let script_pubkey = vhtlc.script_pubkey();
    let tapscripts = vhtlc.tapscripts();

    let refund_locktime = swap.client_locktime as u32;
    let vhtlc_inputs: std::result::Result<Vec<VtxoInput>, Error> = vtxo_list
        .spendable_offchain()
        .map(|v| {
            let locktime = LockTime::from_time(refund_locktime)
                .map_err(|e| Error::Vhtlc(format!("Invalid locktime: {}", e)))?;
            Ok(VtxoInput::new(
                script_ver.0.clone(),
                Some(locktime),
                control_block.clone(),
                tapscripts.clone(),
                script_pubkey.clone(),
                v.amount,
                v.outpoint,
            ))
        })
        .collect();

    let vhtlc_inputs = vhtlc_inputs?;
    let outputs = vec![(&refund_ark_address, total_amount)];

    let OffchainTransactions {
        mut ark_tx,
        checkpoint_txs,
    } = build_offchain_transactions(&outputs, None, &vhtlc_inputs, &server_info)
        .map_err(|e| Error::Vhtlc(format!("Failed to build offchain TXs: {}", e)))?;

    // Sign function (no preimage needed for refund)
    let sign_fn = |_: &mut psbt::Input,
                   msg: secp256k1::Message|
     -> std::result::Result<
        Vec<(schnorr::Signature, XOnlyPublicKey)>,
        ark_rs::core::Error,
    > {
        let sig = Secp256k1::new().sign_schnorr_no_aux_rand(&msg, &own_kp);
        let pk = own_kp.public_key().into();

        Ok(vec![(sig, pk)])
    };

    sign_ark_transaction(sign_fn, &mut ark_tx, 0)
        .map_err(|e| Error::Vhtlc(format!("Failed to sign ark transaction: {}", e)))?;

    let ark_txid = ark_tx.unsigned_tx.compute_txid();

    let res = rest_client
        .submit_offchain_transaction_request(ark_tx, checkpoint_txs)
        .await
        .map_err(|e| Error::Arkade(format!("Failed to submit offchain TXs: {:?}", e)))?;

    let mut checkpoint_psbts = res.signed_checkpoint_txs;
    for checkpoint_psbt in checkpoint_psbts.iter_mut() {
        sign_checkpoint_transaction(sign_fn, checkpoint_psbt)
            .map_err(|e| Error::Vhtlc(format!("Failed to sign checkpoint TX: {}", e)))?;
    }

    rest_client
        .finalize_offchain_transaction(ark_txid, checkpoint_psbts)
        .await
        .map_err(|e| Error::Arkade(format!("Failed to finalize transaction: {}", e)))?;

    log::info!(
        "Refunded client's VHTLC in VTXO swap with transaction {}",
        ark_txid
    );

    Ok(ark_txid)
}

/// Parse a hex-encoded public key.
fn parse_public_key(hex_str: &str) -> Result<PublicKey> {
    let bytes =
        hex::decode(hex_str).map_err(|e| Error::Parse(format!("Invalid public key hex: {}", e)))?;
    PublicKey::from_slice(&bytes).map_err(|e| Error::Bitcoin(format!("Invalid public key: {}", e)))
}
