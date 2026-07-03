-- pg_dump-style dump of the OLD Portfolio Django plaid schema + the bundled
-- fixture rows. For DOCUMENTATION and for manual runs of migrate-portfolio.ts
-- against a real Postgres:
--
--   createdb portfolio_fixture
--   psql portfolio_fixture -f scripts/fixtures/portfolio-fixture.sql
--   OLD_DATABASE_URL=postgres://.../portfolio_fixture \
--   OLD_FERNET_KEY=2LYn5R0fd72iZoO2bYJLiWHZsr77LsOF2chwwy_wkxA \
--   OWNER_EMAIL=you@example.com npm run migrate:portfolio
--
-- The kept in sync with portfolio-fixture.ts (same rows, same Fernet key).
-- access_token is bytea holding the ASCII of a Fernet token (Django BinaryField).

BEGIN;

CREATE TABLE plaid_plaidinstitution (
  institution_id varchar(100) PRIMARY KEY,
  name          varchar(100) NOT NULL,
  primary_color varchar(100),
  url           varchar(100),
  logo          varchar(1000),
  last_updated  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plaid_plaiditem (
  item_id              varchar(100) PRIMARY KEY,
  user_id              integer NOT NULL,
  institution_id       varchar(100) NOT NULL REFERENCES plaid_plaidinstitution(institution_id),
  access_token         bytea NOT NULL,
  last_updated         timestamptz NOT NULL DEFAULT now(),
  last_force_refreshed timestamptz NOT NULL
);

CREATE TABLE plaid_plaidaccount (
  account_id       varchar(100) PRIMARY KEY,
  item_id          varchar(100) NOT NULL REFERENCES plaid_plaiditem(item_id),
  name             varchar(100) NOT NULL,
  official_name    varchar(100),
  account_type     varchar(100) NOT NULL,
  account_subtype  varchar(100),
  available        numeric(17,4),
  current          numeric(17,4),
  "limit"          numeric(17,4),
  iso_currency_code varchar(100),
  last_updated     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plaid_transactioncategory (
  name   varchar(100) PRIMARY KEY,
  budget numeric(17,4) NOT NULL DEFAULT 0
);

CREATE TABLE plaid_plaidtransaction (
  transaction_id        varchar(100) PRIMARY KEY,
  account_id            varchar(100) NOT NULL REFERENCES plaid_plaidaccount(account_id),
  amount                numeric(17,4) NOT NULL,
  iso_currency_code     varchar(100),
  category              text,
  datetime              timestamptz NOT NULL,
  name                  varchar(100) NOT NULL,
  merchant_name         varchar(100),
  payment_channel       varchar(100) NOT NULL,
  pending               boolean NOT NULL,
  pending_transaction_id varchar(100),
  last_updated          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plaid_plaidtransactionmeta (
  transaction_id       varchar(100) PRIMARY KEY REFERENCES plaid_plaidtransaction(transaction_id),
  predicted_category_id varchar(100) NOT NULL REFERENCES plaid_transactioncategory(name),
  last_updated         timestamptz NOT NULL DEFAULT now()
);

INSERT INTO plaid_plaidinstitution (institution_id, name, primary_color, url, logo) VALUES
  ('ins_fixture_001', 'Fixture Bank', '#0055ff', 'https://fixturebank.example', NULL),
  ('ins_fixture_002', 'Second Fixture CU', NULL, NULL, NULL);

-- access_token bytea = ASCII bytes of the Fernet token (convert_to(..., 'UTF8')).
INSERT INTO plaid_plaiditem (item_id, user_id, institution_id, access_token, last_force_refreshed) VALUES
  ('item_fixture_001', 7, 'ins_fixture_001', convert_to('gAAAAABl7IeAABEiM0RVZneImaq7zN3u_0MuvL3lDF3KhgQfiZB87tzEorLrP01jI8saU5FZvudRi4x8Q67UuZSDVFfekEyaAPClM1_LsMOguWiRjRdzw5knTv-glx6sIcGarafonSc6QhK2oMOignCWT1bzShsXZA', 'UTF8'), '2024-03-01T12:00:00Z'),
  ('item_fixture_002', 7, 'ins_fixture_002', convert_to('gAAAAABl7IeA_-7dzLuqmYh3ZlVEMyIRANjrl1f_K3odwhRBq3ViDvqKoOd_56_5-fJU6yk8aso2em-14HxJ80sA8q5C-AOxBtdruN0vVFWV8srGwCtCrLK0eAgTbDVRnNjJt8F8m0-KEb2D8FO9PZY9SkwseAncXw', 'UTF8'), '2024-03-01T12:00:00Z');

INSERT INTO plaid_plaidaccount (account_id, item_id, name, official_name, account_type, account_subtype, available, current, "limit", iso_currency_code) VALUES
  ('acct_fixture_chq', 'item_fixture_001', 'Everyday Chequing', 'Fixture Bank Everyday Chequing', 'depository', 'checking', 1840.5000, 1900.0000, NULL, 'CAD'),
  ('acct_fixture_sav', 'item_fixture_001', 'High-Interest Savings', NULL, 'depository', 'savings', 8200.0000, 8200.0000, NULL, 'CAD'),
  ('acct_fixture_cc', 'item_fixture_002', 'Rewards Card', 'Second Fixture CU Rewards Mastercard', 'credit', 'credit card', 3200.0000, 800.0000, 4000.0000, 'CAD');

INSERT INTO plaid_transactioncategory (name, budget) VALUES
  ('Food And Drink', 300.0000),
  ('Groceries', 600.0000),
  ('Shopping', 200.0000),
  ('Entertainment', 50.0000);

INSERT INTO plaid_plaidtransaction (transaction_id, account_id, amount, iso_currency_code, category, datetime, name, merchant_name, payment_channel, pending, pending_transaction_id) VALUES
  ('txn_fixture_0001', 'acct_fixture_chq', 42.5000, 'CAD', '{"primary":"FOOD_AND_DRINK","detailed":"FOOD_AND_DRINK_OTHER","confidence_level":"HIGH"}', '2024-02-10T09:15:00Z', 'Blue Bottle Coffee', 'Blue Bottle', 'in store', false, NULL),
  ('txn_fixture_0002', 'acct_fixture_chq', 128.0000, 'CAD', '{"primary":"GROCERIES","detailed":"GROCERIES_OTHER","confidence_level":"HIGH"}', '2024-02-12T18:40:00Z', 'Whole Foods Market', 'Whole Foods Market', 'in store', false, NULL),
  ('txn_fixture_0003', 'acct_fixture_sav', -500.0000, 'CAD', '{"primary":"INCOME","detailed":"INCOME_OTHER","confidence_level":"HIGH"}', '2024-02-15T00:00:00Z', 'Payroll Deposit', NULL, 'other', false, NULL),
  ('txn_fixture_0004', 'acct_fixture_cc', 89.9900, 'CAD', '{"primary":"GENERAL_MERCHANDISE","detailed":"GENERAL_MERCHANDISE_OTHER","confidence_level":"HIGH"}', '2024-02-18T14:05:00Z', 'Amazon.ca', 'Amazon', 'online', false, NULL),
  ('txn_fixture_0005', 'acct_fixture_cc', 15.0000, 'CAD', '{"primary":"ENTERTAINMENT","detailed":"ENTERTAINMENT_OTHER","confidence_level":"HIGH"}', '2024-02-20T02:00:00Z', 'Netflix', 'Netflix', 'online', false, NULL);

INSERT INTO plaid_plaidtransactionmeta (transaction_id, predicted_category_id) VALUES
  ('txn_fixture_0001', 'Food And Drink'),
  ('txn_fixture_0002', 'Groceries'),
  ('txn_fixture_0004', 'Shopping'),
  ('txn_fixture_0005', 'Entertainment');

COMMIT;
