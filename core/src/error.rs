//! Error types for the Lendaswap Client SDK.

use thiserror::Error;

/// Result type alias using our Error type.
pub type Result<T> = std::result::Result<T, Error>;

/// Errors that can occur in the Lendaswap Client SDK.
#[derive(Error, Debug)]
pub enum Error {
    /// No mnemonic found in storage.
    #[error("No mnemonic found in storage. Generate or import one first.")]
    NoMnemonic,

    /// Invalid mnemonic phrase.
    #[error("Invalid mnemonic phrase: {0}")]
    InvalidMnemonic(String),

    /// Swap not found in storage.
    #[error("Swap not found: {0}")]
    SwapNotFound(String),

    /// Storage operation failed.
    #[error("Storage error: {0}")]
    Storage(String),

    /// Parse error.
    #[error("Parse error: {0}")]
    Parse(String),

    /// Serialization/deserialization error.
    #[error("Serialization error: {0}")]
    Serde(#[from] serde_json::Error),

    /// Bitcoin-related error.
    #[error("Bitcoin error: {0}")]
    Bitcoin(String),

    /// Key derivation error.
    #[error("Key derivation error: {0}")]
    KeyDerivation(String),

    /// VHTLC operation error.
    #[error("VHTLC error: {0}")]
    Vhtlc(String),

    /// Network/HTTP error.
    #[error("Network error: {0}")]
    Network(String),

    /// Arkade error.
    #[error("Arkade error: {0}")]
    Arkade(String),

    /// Generic error with context.
    #[error("{0}")]
    Other(String),
}

impl From<anyhow::Error> for Error {
    fn from(err: anyhow::Error) -> Self {
        Error::Other(format!("{:#}", err))
    }
}
