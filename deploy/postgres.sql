CREATE TABLE IF NOT EXISTS platform_documents (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS platform_usage (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  month text NOT NULL,
  event jsonb NOT NULL,
  import_key text UNIQUE
);
CREATE INDEX IF NOT EXISTS platform_usage_month_idx ON platform_usage(month);
