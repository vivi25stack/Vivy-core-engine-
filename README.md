# 📱 Vivy Core Engine

The central backend architecture for the Vivy 1-on-1 audio/video calling application. This engine securely manages user profiles, host profiles, agency commission structures, and handles the automated 30-second coin extraction loop.

---

## ⚙️ Core Logic Loop
1. Every 30 seconds during a live call, the server pulls the host's 30-second flat billing rate.
2. It automatically subtracts those coins from the Caller's wallet and deposits them into the Host's balance.
3. If the user runs out of coins mid-call, the server kills the loop timer instantly to prevent free streaming.
