const vectors = {
  strictArkadeVhtlcV1: {
    network: "regtest",
    arkadeHrp: "tark",
    sender: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    receiver:
      "c6047f9441ed7d6d3045406e95c07cd85a36d01ff9f65f5ff4bbe7c5c3237a49",
    server: "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9",
    preimageHash: "000102030405060708090a0b0c0d0e0f10111213",
    refundLocktime: 144,
    unilateralClaimDelay: 21,
    unilateralRefundDelay: 34,
    unilateralRefundWithoutReceiverDelay: 55,
    scripts: {
      claim:
        "82012088a914000102030405060708090a0b0c0d0e0f10111213876920c6047f9441ed7d6d3045406e95c07cd85a36d01ff9f65f5ff4bbe7c5c3237a49ad20f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9ac",
      refund:
        "2079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798ad20c6047f9441ed7d6d3045406e95c07cd85a36d01ff9f65f5ff4bbe7c5c3237a49ad20f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9ac",
      refundWithoutReceiver:
        "029000b1752079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798ad20f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9ac",
      unilateralClaim:
        "82012088a914000102030405060708090a0b0c0d0e0f1011121387690115b27520c6047f9441ed7d6d3045406e95c07cd85a36d01ff9f65f5ff4bbe7c5c3237a49ac",
      unilateralRefund:
        "0122b2752079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798ad20c6047f9441ed7d6d3045406e95c07cd85a36d01ff9f65f5ff4bbe7c5c3237a49ac",
      unilateralRefundWithoutReceiver:
        "0137b2752079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798ac",
    },
    scriptPubKey:
      "512000978a8c8e84166e7edaa8649d561669c650b4e2900e70b9a7bdc6fb8630e457",
    address:
      "tark1qrunpzspjfvvxyzfx38ct7ya2g5m2vwggkpklxdsscqlzyauuqm0jqyh32xgapqkdeld42ryn4tpv6wx2z6w9yqwwzu600wxlwrrpezh7saegv",
  },
} as const;

export default vectors;
