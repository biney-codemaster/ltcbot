# ltcbot — Discord Litecoin Escrow

Bot Discord d'escrow LTC avec **wallet HD local** :
chaque deal reçoit une adresse unique → fonds sur cette adresse → libération on-chain vers le vendeur.

## Pourquoi ce mode

- **Aucun compte** BlockBee / OxaPay / Plisio / NOWPayments
- **Aucun minimum** imposé par une API tierce
- Adresse **nouvelle par deal** (dérivation BIP84) — jamais réutilisée après payout
- Tu contrôles la seed (self-custody)

## Prérequis

1. Bot Discord + intents Guilds
2. Node.js 18+ (20+ recommandé)
3. Accès sortant HTTPS vers `litecoinspace.org` (explorer + broadcast)

## Installation

```bash
cp .env.example .env
# remplir DISCORD_* ; LTC_WALLET_MNEMONIC optionnel au 1er start
npm install
npm start
```

Au **premier démarrage**, si `LTC_WALLET_MNEMONIC` est vide, le bot crée `wallet.mnemonic` et l'affiche dans les logs. **Sauvegarde cette seed** (Pterodactyl backups / gestionnaire de mots de passe).

## Variables `.env`

| Variable | Requis | Rôle |
|----------|--------|------|
| `DISCORD_TOKEN` | oui | Token Discord |
| `CLIENT_ID` | oui | Application ID |
| `GUILD_ID` | reco | Serveur de test |
| `STAFF_ROLE_ID` | reco | Rôle staff |
| `LTC_WALLET_MNEMONIC` | reco | Seed BIP39 (sinon `wallet.mnemonic`) |

## Flow

1. `/setup` → panneau
2. Deal → rôles → confirmation
3. Adresse LTC unique générée (HD `m/84'/2'/0'/0/{n}`)
4. Acheteur paie → confirmations (poll 30s via litecoinspace)
5. Vendeur donne son adresse → acheteur libère
6. Bot signe et broadcast le payout depuis l'adresse du deal
7. L'adresse deal n'est plus réutilisée

## Important

- **Sauvegarde la seed** : sans elle, impossible de recovery les fonds.
- Les seuls frais sont ceux du **réseau Litecoin** au moment du payout (quelques sat/vB).
- Ne partage jamais `wallet.mnemonic` ni `LTC_WALLET_MNEMONIC`.
