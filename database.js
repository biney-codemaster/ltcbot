const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "escrow.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS deals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deal_code TEXT NOT NULL UNIQUE,  -- code aléatoire 6 caractères (ex: A3F9K2), affiché à la place de l'id

    -- Contexte Discord (pour retrouver/mettre à jour le bon message et salon)
    guild_id TEXT NOT NULL,
    channel_id TEXT,
    message_id TEXT,

    -- Participants
    initiator_id TEXT NOT NULL,   -- celui qui a rempli le formulaire
    partner_id TEXT NOT NULL,     -- l'autre personne (rôle défini une fois le deal confirmé)
    buyer_id TEXT,                -- qui paie (fixé après confirmation des deux côtés)
    seller_id TEXT,                -- qui reçoit le paiement

    -- Détails du deal
    product TEXT NOT NULL,
    price REAL NOT NULL,          -- montant en devise fiat (€ ou $)
    currency TEXT NOT NULL,       -- '€' ou '$'
    crypto TEXT NOT NULL DEFAULT 'LTC', -- crypto choisie pour le paiement (LTC pour l'instant)

    -- Paiement crypto (NOWPayments)
    payment_id TEXT,              -- ID de paiement NOWPayments
    pay_address TEXT,             -- adresse LTC générée pour ce deal
    pay_amount REAL,              -- montant équivalent en crypto (estimé à la création)
    paid_at TEXT,                 -- date de réception du paiement

    -- Statut du deal:
    -- pending_confirmation -> en attente que le partenaire accepte les termes
    -- awaiting_payment     -> confirmé, en attente du paiement LTC
    -- funds_held           -> paiement reçu, en attente d'envoi du produit
    -- released             -> fonds envoyés au vendeur, deal terminé
    -- disputed             -> litige ouvert
    -- cancelled            -> annulé avant paiement
    status TEXT NOT NULL DEFAULT 'pending_confirmation',

    -- Litige
    dispute_reason TEXT,
    mediator_id TEXT,             -- modérateur assigné au litige

    -- Horodatage
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// Migration légère si la base existait déjà avant l'ajout de deal_code
try {
  db.exec(`ALTER TABLE deals ADD COLUMN deal_code TEXT`);
} catch {
  // colonne déjà présente
}
try {
  db.exec(`ALTER TABLE deals ADD COLUMN initiator_confirmed INTEGER NOT NULL DEFAULT 0`);
} catch {
  // colonne déjà présente
}
try {
  db.exec(`ALTER TABLE deals ADD COLUMN partner_confirmed INTEGER NOT NULL DEFAULT 0`);
} catch {
  // colonne déjà présente
}
try {
  db.exec(`ALTER TABLE deals ADD COLUMN confirm_message_id TEXT`);
} catch {
  // colonne déjà présente
}
try {
  db.exec(`ALTER TABLE deals ADD COLUMN crypto TEXT NOT NULL DEFAULT 'LTC'`);
} catch {
  // colonne déjà présente
}
try {
  db.exec(`ALTER TABLE deals ADD COLUMN payment_status TEXT`);
} catch {
  // colonne déjà présente
}
try {
  db.exec(`ALTER TABLE deals ADD COLUMN payment_message_id TEXT`);
} catch {
  // colonne déjà présente
}
try {
  db.exec(`ALTER TABLE deals ADD COLUMN seller_wallet TEXT`);
} catch {
  // colonne déjà présente
}
try {
  db.exec(`ALTER TABLE deals ADD COLUMN payout_id TEXT`);
} catch {
  // colonne déjà présente
}
try {
  db.exec(`ALTER TABLE deals ADD COLUMN payout_status TEXT`);
} catch {
  // colonne déjà présente
}
try {
  db.exec(`ALTER TABLE deals ADD COLUMN payout_error TEXT`);
} catch {
  // colonne déjà présente
}
try {
  db.exec(`ALTER TABLE deals ADD COLUMN funds_held_message_id TEXT`);
} catch {
  // colonne déjà présente
}

module.exports = db;
