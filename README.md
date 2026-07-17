# ltcbot — Discord Litecoin Escrow

Bot Discord d'escrow LTC via **Plisio** :
l'acheteur paie → fonds sur le solde Plisio → libération vers l'adresse du vendeur.

## Pourquoi Plisio

- Inscription **instantanée** (pas d'attente d'approbation type OxaPay)
- Pas de KYC pour démarrer
- Minimum LTC très bas
- Une seule clé API (`PLISIO_API_KEY`)
- Invoice + withdrawal (`cash_out`) pour l'escrow

## Prérequis

1. Bot Discord (token + `CLIENT_ID`) avec intents **Guilds**
2. Compte [Plisio](https://plisio.net) + shop API (secret key)
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
| `PLISIO_API_KEY` | oui | Secret key Plisio (API settings) |
| `PLISIO_CALLBACK_URL` | optionnel | Webhook (non requis : polling 30s) |

## Setup Plisio

1. Créer un compte sur [plisio.net](https://plisio.net) (immédiat)
2. API → créer / configurer un **shop**
3. Copier la **Secret key** → `PLISIO_API_KEY`
4. Activer le **White-label** sur le shop (sinon pas d'adresse LTC dans l'API, seulement un lien invoice)
5. Pour les payouts : whitelister l'**IP du VPS** dans les settings API (Request IP)

## Flow

1. `/setup` → panneau
2. Start a deal → formulaire
3. Rôles acheteur / vendeur → double confirmation
4. Adresse LTC (white-label) → acheteur paie
5. Statut `completed` → fonds sur solde Plisio
6. Vendeur renseigne son adresse → acheteur libère
7. `cash_out` Plisio → vendeur

## Emojis custom

Dans `config.js`, remplace chaque `null` par `<:nom:id>` (copie via `\:emoji:` sur Discord).

## Mise en prod

1. Remplir `.env` avec `PLISIO_API_KEY`
2. White-label ON + IP VPS whitelistée
3. `npm start`
4. `/setup` puis un deal réel
