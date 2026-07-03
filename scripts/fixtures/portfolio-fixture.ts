// Bundled fixture of the OLD Portfolio Django plaid schema — row shapes mirror
// the source tables (snake_case columns) so `--fixture` mode flows through the
// exact same transform/upsert path as the pg reader (only the reader differs).
//
// access_token values are REAL Fernet tokens minted under FIXTURE_FERNET_KEY
// below, so `--fixture` exercises the Fernet decrypt path with zero production
// access. Plaintext behind each token is the string in the trailing comment.
// See portfolio-fixture.sql for the equivalent pg_dump for manual runs.
import type { SourceRows } from "../migrate-portfolio";

// Pass this as OLD_FERNET_KEY when running non-fixture mode against a restore of
// portfolio-fixture.sql. In --fixture mode the script uses it automatically.
export const FIXTURE_FERNET_KEY = "2LYn5R0fd72iZoO2bYJLiWHZsr77LsOF2chwwy_wkxA";

const cat = (primary: string) =>
  JSON.stringify({ primary, detailed: `${primary}_OTHER`, confidence_level: "HIGH" });

// Dates as ISO strings, like a bytea/text column would deserialize from pg.
export const fixtureRows: SourceRows = {
  institutions: [
    { institution_id: "ins_fixture_001", name: "Fixture Bank", primary_color: "#0055ff", url: "https://fixturebank.example", logo: null },
    { institution_id: "ins_fixture_002", name: "Second Fixture CU", primary_color: null, url: null, logo: null },
  ],
  items: [
    // access_token plaintext: access-production-fixture-token-0000000000000001
    { item_id: "item_fixture_001", user_id: 7, institution_id: "ins_fixture_001", access_token: "gAAAAABl7IeAABEiM0RVZneImaq7zN3u_0MuvL3lDF3KhgQfiZB87tzEorLrP01jI8saU5FZvudRi4x8Q67UuZSDVFfekEyaAPClM1_LsMOguWiRjRdzw5knTv-glx6sIcGarafonSc6QhK2oMOignCWT1bzShsXZA", last_force_refreshed: "2024-03-01T12:00:00.000Z" },
    // access_token plaintext: access-production-fixture-token-0000000000000002
    { item_id: "item_fixture_002", user_id: 7, institution_id: "ins_fixture_002", access_token: "gAAAAABl7IeA_-7dzLuqmYh3ZlVEMyIRANjrl1f_K3odwhRBq3ViDvqKoOd_56_5-fJU6yk8aso2em-14HxJ80sA8q5C-AOxBtdruN0vVFWV8srGwCtCrLK0eAgTbDVRnNjJt8F8m0-KEb2D8FO9PZY9SkwseAncXw", last_force_refreshed: "2024-03-01T12:00:00.000Z" },
  ],
  accounts: [
    { account_id: "acct_fixture_chq", item_id: "item_fixture_001", name: "Everyday Chequing", official_name: "Fixture Bank Everyday Chequing", account_type: "depository", account_subtype: "checking", available: "1840.5000", current: "1900.0000", limit: null, iso_currency_code: "CAD" },
    { account_id: "acct_fixture_sav", item_id: "item_fixture_001", name: "High-Interest Savings", official_name: null, account_type: "depository", account_subtype: "savings", available: "8200.0000", current: "8200.0000", limit: null, iso_currency_code: "CAD" },
    { account_id: "acct_fixture_cc", item_id: "item_fixture_002", name: "Rewards Card", official_name: "Second Fixture CU Rewards Mastercard", account_type: "credit", account_subtype: "credit card", available: "3200.0000", current: "800.0000", limit: "4000.0000", iso_currency_code: "CAD" },
  ],
  // Posted charges/refunds with merchants — every vendor is unknown at migration
  // time, so the next analyzeUser flags them (nothing grandfathered).
  transactions: [
    { transaction_id: "txn_fixture_0001", account_id: "acct_fixture_chq", amount: "42.5000", iso_currency_code: "CAD", category: cat("FOOD_AND_DRINK"), datetime: "2024-02-10T09:15:00.000Z", name: "Blue Bottle Coffee", merchant_name: "Blue Bottle", payment_channel: "in store", pending: false, pending_transaction_id: null },
    { transaction_id: "txn_fixture_0002", account_id: "acct_fixture_chq", amount: "128.0000", iso_currency_code: "CAD", category: cat("GROCERIES"), datetime: "2024-02-12T18:40:00.000Z", name: "Whole Foods Market", merchant_name: "Whole Foods Market", payment_channel: "in store", pending: false, pending_transaction_id: null },
    { transaction_id: "txn_fixture_0003", account_id: "acct_fixture_sav", amount: "-500.0000", iso_currency_code: "CAD", category: cat("INCOME"), datetime: "2024-02-15T00:00:00.000Z", name: "Payroll Deposit", merchant_name: null, payment_channel: "other", pending: false, pending_transaction_id: null },
    { transaction_id: "txn_fixture_0004", account_id: "acct_fixture_cc", amount: "89.9900", iso_currency_code: "CAD", category: cat("GENERAL_MERCHANDISE"), datetime: "2024-02-18T14:05:00.000Z", name: "Amazon.ca", merchant_name: "Amazon", payment_channel: "online", pending: false, pending_transaction_id: null },
    { transaction_id: "txn_fixture_0005", account_id: "acct_fixture_cc", amount: "15.0000", iso_currency_code: "CAD", category: cat("ENTERTAINMENT"), datetime: "2024-02-20T02:00:00.000Z", name: "Netflix", merchant_name: "Netflix", payment_channel: "online", pending: false, pending_transaction_id: null },
  ],
  // Global category rows with budgets → become per-owner TransactionCategory rows.
  categories: [
    { name: "Food And Drink", budget: "300.0000" },
    { name: "Groceries", budget: "600.0000" },
    { name: "Shopping", budget: "200.0000" },
    { name: "Entertainment", budget: "50.0000" },
  ],
  // transaction → predicted_category (a category name). txn_0003 has no meta →
  // its migrated predictedCategory stays null.
  metas: [
    { transaction_id: "txn_fixture_0001", predicted_category_id: "Food And Drink" },
    { transaction_id: "txn_fixture_0002", predicted_category_id: "Groceries" },
    { transaction_id: "txn_fixture_0004", predicted_category_id: "Shopping" },
    { transaction_id: "txn_fixture_0005", predicted_category_id: "Entertainment" },
  ],
};
