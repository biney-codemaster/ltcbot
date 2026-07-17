# ltcbot — Discord Litecoin Escrow

Bot Discord d'escrow LTC via **BlockBee** :
l'acheteur paie → fonds sur ton Self-Custodial Wallet → libération vers le vendeur.

## Pourquoi BlockBee

- Inscription **instantanée** (pas d'approbation OxaPay)
- **Pas de vérification de domaine** (contrairement à Plisio)
- Une seule clé : `BLOCKBEE_API_KEY` (API Key **V2**)
- Minimum LTC ≈ **0.002 LTC** (~0.08–0.20€ selon le cours) — mieux que NOWPayments (~2$)

## Prérequis

1. Bot Discord + intents Guilds
2. Compte [BlockBee](https://dash.blockbee.io/) + **API Key V2** (+ Recovery Key sauvegardée)
3. Node.js 18+

## Installation

```bash
cp .env.example .env
# remplir BLOCKBEE_API_KEY=...
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
| `BLOCKBEE_API_KEY` | oui | API Key **V2** BlockBee |

## Setup BlockBee (5 min)

1. Créer un compte sur [dash.blockbee.io](https://dash.blockbee.io/)
2. **API Keys** → générer **API Key V2** (sauvegarde aussi la Recovery Key !)
3. **Wallet** → activer le Self-Custodial Wallet LTC
4. Sur la page Wallet : **Set Self-Custodial Wallet** comme destination des paiements reçus
5. Coller la clé V2 dans `BLOCKBEE_API_KEY`
6. `npm start`

## Important

- Deals **sous ~0.002 LTC** (souvent ~0.05€) = fonds perdus côté réseau. Mets au moins ~0.20€.
- Sans Self-Custodial Wallet comme destination, le payout vendeur ne marchera pas.

## Flow

1. `/setup` → panneau
2. Deal → rôles → confirmation
3. Adresse LTC générée → acheteur paie
4. Confirmations → fonds sécurisés
5. Vendeur donne son adresse → acheteur libère
6. Payout BlockBee → vendeur
