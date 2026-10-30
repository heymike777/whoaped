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
    "mobile_realtime": "authenticated-websocket-over-mongodb-change-streams",
    "push": "firebase-cloud-messaging",
    "multichain_boundary": "ChainAdapter"
  },
  "pipeline": {
    "ingestion_method": "websocket",
    "data_types": ["transactions", "token-transfers", "decoded-instructions"],
    "storage": "mongodb",
    "commitment": "confirmed",
    "backfill_implemented": true
  },
  "debug": {
    "issues_resolved": [
      {
        "error": "Meteora DLMM add-liquidity transaction was normalized as a generic balance change",
        "cause": "The yield protocol registry only covered Meteora Vaults and did not map the DLMM lb_clmm program ID",
        "fix": "Recognize Meteora DLMM by program ID and parsed protocol, and use Helius liquidity summary amounts for both deposited assets"
      }
    ],
    "last_debug_session": "2026-10-30T13:31:00.000Z"
  }
}
