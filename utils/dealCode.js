const crypto = require("crypto");
const db = require("../database");

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sans caractères ambigus (0/O, 1/I/l)
const LENGTH = 6;

function randomCode() {
  let code = "";
  for (let i = 0; i < LENGTH; i++) {
    code += CHARS[crypto.randomInt(CHARS.length)];
  }
  return code;
}

/**
 * Génère un code unique en vérifiant qu'il n'existe pas déjà en base.
 */
function generateUniqueDealCode() {
  const check = db.prepare("SELECT 1 FROM deals WHERE deal_code = ?");
  let code;
  do {
    code = randomCode();
  } while (check.get(code));
  return code;
}

module.exports = { generateUniqueDealCode };
