# ltcbot — Discord Litecoin Escrow

Bot Discord d'escrow LTC via **OxaPay** :
l'acheteur paie → fonds gardés sur le solde OxaPay → libération vers l'adresse du vendeur.

## Prérequis

1. Bot Discord (token + `CLIENT_ID`) avec intents **Guilds**
2. Compte [OxaPay](https://oxapay.com) + clés **Merchant** et **Payout**
3. Node.js 18+

## Installation

```bash
cp .env.example .env
# remplir le .env
npm install
npm start
```

## Variables `.env`

| Variable | Requis | Rôle |
|----------|--------|------|
| `DISCORD_TOKEN` | oui | Token du bot |
| `CLIENT_ID` | oui | Application ID |
| `GUILD_ID` | reco | Serveur de test (commandes instantanées) |
| `STAFF_ROLE_ID` | reco | Rôle médiateur / fermeture salons |
| `OXAPAY_MERCHANT_API_KEY` | oui | Création des paiements LTC (white-label) |
| `OXAPAY_PAYOUT_API_KEY` | payout | Libération des fonds vers le vendeur |
| `OXAPAY_CALLBACK_URL` | optionnel | Webhook (non requis : polling 30s) |

## OxaPay (escrow)

1. Créer un compte sur [oxapay.com](https://oxapay.com)
2. Dashboard → **Merchant API** → copier la clé → `OXAPAY_MERCHANT_API_KEY`
3. Dashboard → **Payout API** → créer une clé (2FA) → `OXAPAY_PAYOUT_API_KEY`
4. Les paiements sont créés avec `auto_withdrawal: false` → fonds sur le **solde OxaPay**
5. À la libération, le bot envoie le LTC du solde vers l'adresse du vendeur

## Minimum de montant

OxaPay accepte des montants bien plus bas que NOWPayments.
Pour LTC, le plancher tourne autour de **≈ 0.002 LTC** (frais réseau).
Un deal à 0.05€ peut passer selon le cours ; si trop bas, le bot affiche le minimum.

## Flow

1. `/setup` (permission Gérer le serveur) → panneau
2. Start a deal → formulaire
3. Rôles acheteur / vendeur → double confirmation
4. Adresse LTC générée → acheteur paie
5. Statut `paid` → fonds sécurisés sur OxaPay
6. Vendeur renseigne son adresse → acheteur libère
7. Payout OxaPay → vendeur

## Emojis custom

Dans `config.js`, remplace chaque `null` par `<:nom:id>` (copie via `\:emoji:` sur Discord).

## Mise en prod

1. Remplir `.env` (Merchant + Payout keys)
2. `npm start` sur le VPS
3. `/setup` sur le serveur
4. Premier deal réel (même petit montant OK tant que ≥ ~0.002 LTC)
