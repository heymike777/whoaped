{
  "mobile": {
    "platform": "react-native",
    "wallet_method": "watch-only-public-address",
    "scaffold_repo": "react-native-community-cli 0.86.2",
    "physical_device_tested": false
  },
  "backend": {
    "runtime": "node-22-hono",
    "database": "mongodb",
    "solana_ingestion": "helius-parsed-streams",
    "push": "firebase-cloud-messaging",
    "multichain_boundary": "ChainAdapter"
  },
  "pipeline": {
    "ingestion_method": "websocket",
    "data_types": ["transactions", "token-transfers", "decoded-instructions"],
    "storage": "mongodb",
    "backfill_implemented": true
  }
}
