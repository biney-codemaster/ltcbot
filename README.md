# ltcbot — Discord Litecoin Escrow

Bot Discord d'escrow LTC via **NOWPayments Custody** :
l'acheteur paie → fonds gardés chez NOWPayments → libération vers l'adresse du vendeur.

## Prérequis

1. Bot Discord (token + `CLIENT_ID`) avec intents **Guilds**
2. Compte [NOWPayments](https://account.nowpayments.io) avec **Custody activé**
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
| `NOWPAYMENTS_API_KEY` | oui | Création des paiements LTC |
| `NOWPAYMENTS_EMAIL` | payout | Auth JWT pour payout Custody |
| `NOWPAYMENTS_PASSWORD` | payout | Auth JWT pour payout Custody |
| `NOWPAYMENTS_2FA_SECRET` | optionnel | Valide auto les payouts (TOTP app) |
| `NOWPAYMENTS_IPN_URL` | optionnel | Webhook (non requis : polling 30s) |

## Minimum de montant (NOWPayments)

**Le bot accepte n'importe quel prix, mais l'API NOWPayments refuse les trop petits paiements.**

- Pour LTC, leur minimum tourne souvent autour de **≈ 2$** (équivalent € variable).
- Le seuil est **dynamique** (frais réseau) : le bot le lit via `GET /v1/min-amount` avant de créer le paiement.
- Si tu mets 0.05€ → erreur `amountTo is too small` / message « Bloqué par l'API NOWPayments ». Ce n'est **pas** contournable côté bot.
- Pour un essai réel : deal **≥ ~2–3€ / $** (idéalement un peu au-dessus du minimum live).

Vérifier le minimum live : [NOWPayments Status](https://nowpayments.io/status) ou l'endpoint `/v1/min-amount`.

## NOWPayments (Custody)

1. Dashboard → **Custody** → activer
2. Ne pas router chaque paiement vers ton wallet perso
3. Pour payer n'importe quel vendeur : assouplir le **whitelist d'adresses**
4. Whitelist l'IP du serveur qui héberge le bot (payouts)
5. Optionnel : secret TOTP de l'app 2FA → `NOWPAYMENTS_2FA_SECRET`

## Flow

1. `/setup` (permission Gérer le serveur) → panneau
2. Start a deal → formulaire
3. Rôles acheteur / vendeur → double confirmation
4. Adresse LTC générée → acheteur paie
5. Statut `finished` → fonds sécurisés
6. Vendeur renseigne son adresse → acheteur libère
7. Payout Custody → vendeur

## Emojis custom

Dans `config.js`, remplace chaque `null` par `<:nom:id>` (copie via `\:emoji:` sur Discord).

## Mise en prod

1. Remplir `.env` + Custody ON + (idéalement) `NOWPAYMENTS_2FA_SECRET`
2. `npm start` sur le VPS
3. `/setup` sur le serveur
4. Premier deal réel **au-dessus du minimum NOWPayments** (~2–3€+)
5. Vérifier payout : whitelist IP + adresses vendeur assouplie
