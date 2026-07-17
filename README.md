# ltcbot — Discord Litecoin Escrow

Bot Discord d'escrow LTC via **BlockBee** :
l'acheteur paie → fonds sur ton Self-Custodial Wallet → libération vers le vendeur.

## Pourquoi BlockBee

- Inscription **instantanée** (pas d'approbation OxaPay)
- **Pas de vérification de domaine** (contrairement à Plisio)
- Minimum LTC ≈ **0.002 LTC** (~0.08–0.20€ selon le cours) — mieux que NOWPayments (~2$)

## Prérequis

1. Bot Discord + intents Guilds
2. Compte [BlockBee](https://dash.blockbee.io/) + **API Key V2** avec **Address Override**
3. Node.js 18+

## Installation

```bash
cp .env.example .env
# remplir BLOCKBEE_API_KEY et BLOCKBEE_LTC_ADDRESS
npm install
npm start
```

## Variables `.env`

| Variable | Requis | Rôle |
|----------|--------|------|
| `DISCORD_TOKEN` | oui | Token Discord |
| `CLIENT_ID` | oui | Application ID |
| `GUILD_ID` | reco | Serveur de test |
| `STAFF_ROLE_ID` | reco | Rôle staff |
| `BLOCKBEE_API_KEY` | oui | API Key **V2** avec permission **Address Override** |
| `BLOCKBEE_LTC_ADDRESS` | reco | Adresse SCW Litecoin (auto-fetch si vide) |

## Setup BlockBee (5 min)

1. Créer un compte sur [dash.blockbee.io](https://dash.blockbee.io/)
2. **Self-Custodial Wallet → Litecoin** → copier ton adresse LTC (ex. `MU9KD2uF...`)
3. **Developers → API Keys** → générer **API Key V2** :
   - Cocher **Address Override** (obligatoire)
   - Sauvegarder la Recovery Key
4. Dans le `.env` :
   ```
   BLOCKBEE_API_KEY=ta_cle_v2
   BLOCKBEE_LTC_ADDRESS=ton_adresse_scw_ltc
   ```
5. `npm start`

## Important

- Deals **sous ~0.002 LTC** (souvent ~0.10€) peuvent échouer. Mets au moins **~0.20€**.
- Sans **Address Override** + adresse SCW, la génération d'adresse de paiement échoue.
- Le payout vendeur utilise le même SCW BlockBee.

## Flow

1. `/setup` → panneau
2. Deal → rôles → confirmation
3. Adresse LTC générée → acheteur paie
4. Confirmations → fonds sécurisés
5. Vendeur donne son adresse → acheteur libère
6. Payout BlockBee → vendeur
