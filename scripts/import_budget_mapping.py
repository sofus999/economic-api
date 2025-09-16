#!/usr/bin/env python3
# import_budget_mapping.py
#
# Loads every squaremeter_accounts_mapping_*.csv  and
# every budget_[YYYY_]AGREEMENT.csv  in the current folder
# into MySQL tables economic_data.account_mapping  and  economic_data.budget
#
# -------------------------------------------------------------

import pandas as pd
import glob, os, re, sys, traceback
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

print("Starting Budget & Mapping Import Script")
print("=====================================\n")

# ──────────────────────────────────────────────────────────────
# 1.  DATABASE CONNECTION  (edit if needed)
# ──────────────────────────────────────────────────────────────
def get_database_engine():
    """Get database engine with environment variable support"""
    # Try to get password from environment variables
    db_password = os.getenv('DATABASE_ROOT_PASSWORD', os.getenv('DB_ROOT_PASSWORD'))
    
    if not db_password:
        raise ValueError("Database password not found in environment variables. Set DATABASE_ROOT_PASSWORD or DB_ROOT_PASSWORD in .env file")
    
    db_host = os.getenv('DB_HOST', '127.0.0.1')
    db_port = os.getenv('DB_PORT', '3306')
    db_name = os.getenv('DB_NAME', 'economic_data')
    db_user = os.getenv('DB_ROOT_USER', 'root')
    
    connection_string = f"mysql+pymysql://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}"
    
    return create_engine(
        connection_string,
        pool_recycle=3600,
        pool_pre_ping=True,
    )

ENGINE = get_database_engine()
print("💾  Connected to economic_data")

# ──────────────────────────────────────────────────────────────
# 2.  CREATE TABLES IF NOT PRESENT
# ──────────────────────────────────────────────────────────────
with ENGINE.begin() as conn:
    conn.exec_driver_sql(
        """
        CREATE TABLE IF NOT EXISTS account_mapping (
          account_number       VARCHAR(20)  NOT NULL,
          agreement_number     VARCHAR(20)  NOT NULL,
          mapping_description  VARCHAR(255),
          category             VARCHAR(255),
          sub_category         VARCHAR(255),
          AccountKey           VARCHAR(50)  NOT NULL,
          PRIMARY KEY (AccountKey)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """
    )
    
    # Add category column to account_mapping if it doesn't exist
    try:
        conn.exec_driver_sql("SELECT category FROM account_mapping LIMIT 1")
        print("✔ Category column already exists in account_mapping table")
    except:
        conn.exec_driver_sql("ALTER TABLE account_mapping ADD COLUMN category VARCHAR(255) AFTER mapping_description")
        print("✔ Added category column to account_mapping table")

    # Add sub_category column to account_mapping if it doesn't exist
    try:
        conn.exec_driver_sql("SELECT sub_category FROM account_mapping LIMIT 1")
        print("✔ Sub_category column already exists in account_mapping table")
    except:
        conn.exec_driver_sql("ALTER TABLE account_mapping ADD COLUMN sub_category VARCHAR(255) AFTER category")
        print("✔ Added sub_category column to account_mapping table")

    conn.exec_driver_sql(
        """
        CREATE TABLE IF NOT EXISTS budget (
          id                   INT          AUTO_INCREMENT,
          account_number       VARCHAR(20)  NULL,
          mapping_description  VARCHAR(255),
          category             VARCHAR(255),
          sub_category         VARCHAR(255),
          year                 INT          NOT NULL,
          month                INT          NOT NULL,
          amount               DECIMAL(15,2),
          agreement_number     VARCHAR(20)  NOT NULL,
          AccountKey           VARCHAR(50)  NULL,
          PRIMARY KEY (id),
          INDEX idx_account_key (AccountKey, agreement_number, year, month),
          INDEX idx_cash_flow (mapping_description, agreement_number, year, month, category)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """
    )
    
    # Add category column to budget if it doesn't exist
    try:
        conn.exec_driver_sql("SELECT category FROM budget LIMIT 1")
        print("✔ Category column already exists in budget table")
    except:
        conn.exec_driver_sql("ALTER TABLE budget ADD COLUMN category VARCHAR(255) AFTER mapping_description")
        print("✔ Added category column to budget table")

    # Add sub_category column to budget if it doesn't exist
    try:
        conn.exec_driver_sql("SELECT sub_category FROM budget LIMIT 1")
        print("✔ Sub_category column already exists in budget table")
    except:
        conn.exec_driver_sql("ALTER TABLE budget ADD COLUMN sub_category VARCHAR(255) AFTER category")
        print("✔ Added sub_category column to budget table")

print("✔  Tables are ready.\n")

# ──────────────────────────────────────────────────────────────
# 3.  DISCOVER FILES
# ──────────────────────────────────────────────────────────────
mapping_files = glob.glob("squaremeter_accounts_mapping_*.csv")
if not mapping_files and os.path.exists("squaremeter_accounts_mapping.csv"):
    mapping_files = ["squaremeter_accounts_mapping.csv"]

budget_files = glob.glob("budget_*.csv")
if not budget_files and os.path.exists("Budget.csv"):
    budget_files = ["Budget.csv"]

print(f"→ Found {len(mapping_files)} mapping files, {len(budget_files)} budget files\n")

if not mapping_files or not budget_files:
    print("⚠  Nothing to import – aborting.")
    sys.exit(0)

# ──────────────────────────────────────────────────────────────
# 4.  LOAD / MERGE  ACCOUNT-MAPPING
# ──────────────────────────────────────────────────────────────
all_map = []

for mf in mapping_files:
    try:
        agr_match = re.search(r"_(\d+)\.csv$", mf)
        agreement = agr_match.group(1) if agr_match else "0000000"

        df = pd.read_csv(mf, sep=";")
        print(f"📊  {mf}: Read {len(df)} total rows from CSV")

        # heuristic for the columns we need
        acc_col = next(c for c in df.columns if re.search(r"account|nr", c, re.I))
        map_col = next(c for c in df.columns if re.search(r"mapping", c, re.I))
        
        # Try to find Category column (case-insensitive)
        cat_col = next((c for c in df.columns if c.lower() == "category"), None)
        
        # Try to find Sub_Category column (case-insensitive)
        sub_cat_col = next((c for c in df.columns if c.lower() == "sub_category"), None)
        
        # Create column list based on available columns
        cols_to_use = [acc_col, map_col]
        rename_dict = {acc_col: "account_number", map_col: "mapping_description"}
        
        if cat_col:
            cols_to_use.append(cat_col)
            rename_dict[cat_col] = "category"

        if sub_cat_col:
            cols_to_use.append(sub_cat_col)
            rename_dict[sub_cat_col] = "sub_category"

        df = df[cols_to_use].rename(columns=rename_dict)
        
        # Only filter out completely empty rows - keep everything else including #N/A
        initial_count = len(df)
        # Don't drop rows based on mapping_description content - keep everything including #N/A
        df = df.dropna(how='all')  # Only drop if ALL columns are NaN
        after_dropna = len(df)
        
        # Don't filter out #N/A or empty strings - keep everything
        df["agreement_number"] = agreement
        df["AccountKey"] = df["account_number"].astype(str) + "_" + agreement
        
        # Ensure category column exists (with empty values if not found in CSV)
        if "category" not in df.columns:
            df["category"] = None
            
        # Ensure sub_category column exists (with empty values if not found in CSV)
        if "sub_category" not in df.columns:
            df["sub_category"] = None

        all_map.append(df)
        print(f"✔  {mf}: {len(df)} rows (dropped {initial_count - after_dropna} completely empty rows)")
    except Exception as e:
        print(f"✖  {mf}: {e}")

if not all_map:
    print("✖  No valid mapping rows – abort.")
    sys.exit(1)

map_df = (
    pd.concat(all_map, ignore_index=True)
    .drop_duplicates(subset=["AccountKey"])
    .astype({"account_number": str, "agreement_number": str})
)

with ENGINE.begin() as conn:
    conn.exec_driver_sql("TRUNCATE TABLE account_mapping")
map_df.to_sql("account_mapping", ENGINE, if_exists="append", index=False)
print(f"\n✔  Loaded {len(map_df)} mapping rows into account_mapping\n")

# ▸ reload for fast look-ups
lookup = pd.read_sql(
    "SELECT account_number, agreement_number, mapping_description, category, sub_category, AccountKey "
    "FROM account_mapping",
    ENGINE,
)

# ──────────────────────────────────────────────────────────────
# 5.  LOAD  BUDGET  FILES
# ──────────────────────────────────────────────────────────────
all_bud = []

for bf in budget_files:
    try:
        # filename patterns
        m = re.search(r"budget_(\d{4})_(\d+)\.csv$", bf, re.I)
        if m:
            year = int(m.group(1))
            agreement = m.group(2)
        else:
            # old pattern budget_<agr>.csv   (year will be 2024)
            m = re.search(r"budget_(\d+)\.csv$", bf, re.I)
            agreement = m.group(1) if m else "0000000"
            year = 2024

        raw = pd.read_csv(bf, sep=";", header=2, dtype=str)  # dtype=str preserves number formatting like 1.740
        raw.rename(columns={raw.columns[0]: "mapping_description"}, inplace=True)
        raw = raw.dropna(how="all")

        # find the 12 month columns - accounting for Primo column
        cols = raw.columns.tolist()
        print(f"DEBUG: All columns in {bf}: {cols}")
        
        if re.search(r"primo", " ".join(cols), re.I):
            primo_idx = next(i for i, c in enumerate(cols) if re.search(r"primo", c, re.I))
            month_cols = cols[primo_idx + 1 : primo_idx + 13]  # Skip Primo, take next 12
            print(f"DEBUG: Found Primo at index {primo_idx}, month_cols: {month_cols}")
        else:
            month_cols = cols[1:13]
            print(f"DEBUG: No Primo found, using cols[1:13]: {month_cols}")

        df = raw.melt(
            id_vars=["mapping_description"],
            value_vars=month_cols,
            var_name="month_name",
            value_name="amount",
        )

        # month number by position (1…12) - January should be month 1
        df["month"] = df["month_name"].apply(lambda c: month_cols.index(c) + 1)
        print(f"DEBUG: Sample of month assignments: {df[['month_name', 'month']].drop_duplicates().head()}")
        df["year"] = year
        df["agreement_number"] = agreement

        # Handle European number format: 1.729 = 1729, 1,5 = 1.5
        def parse_european_number(value_str):
            if pd.isna(value_str) or value_str == '':
                return None
            
            # Clean the string
            clean_str = str(value_str).strip()
            clean_str = re.sub(r'[^\d,.\-]', '', clean_str)
            
            if clean_str == '' or clean_str == '-':
                return None
            
            # Handle European format: period as thousands separator, comma as decimal
            if ',' in clean_str and '.' in clean_str:
                # Both present: last one is decimal separator
                if clean_str.rfind(',') > clean_str.rfind('.'):
                    # Comma is decimal separator, period is thousands
                    clean_str = clean_str.replace('.', '').replace(',', '.')
                else:
                    # Period is decimal separator, comma is thousands  
                    clean_str = clean_str.replace(',', '')
            elif ',' in clean_str:
                # Only comma: assume decimal separator for small numbers, thousands for large
                if clean_str.count(',') == 1 and len(clean_str.split(',')[1]) <= 2:
                    # Likely decimal: 1,5 → 1.5
                    clean_str = clean_str.replace(',', '.')
                else:
                    # Likely thousands: 1,729 → 1729
                    clean_str = clean_str.replace(',', '')
            elif '.' in clean_str:
                # In European accounting format, periods are almost always thousands separators
                # Only treat as decimal for very specific small decimal cases
                parts = clean_str.split('.')
                if (clean_str.count('.') == 1 and 
                    len(parts[0]) <= 2 and           # Max 2 digits before period (like 1.5, 12.3)
                    len(parts[1]) == 1 and           # Exactly 1 digit after period
                    int(parts[1]) != 0 and           # Non-zero digit after period (excludes 1.0, 2.0)
                    int(parts[0]) <= 99):            # Small number before period
                    # Very specific case: 1.5, 2.3, 12.7 → keep as decimal
                    pass
                else:
                    # All other cases: treat as thousands separator
                    # 1.700, 1.730, 1.190, 19.428 → 1700, 1730, 1190, 19428
                    clean_str = clean_str.replace('.', '')
            
            try:
                return float(clean_str)
            except ValueError:
                return None
        
        df["amount"] = df["amount"].apply(parse_european_number)
        df = df.dropna(subset=["amount"])

        # IMPROVED FILTER: More specific filtering that preserves Cash Flow entries
        # Only filter out obvious header/total lines, not legitimate data entries
        df = df[
            ~df["mapping_description"]
            .astype(str)
            .str.contains(r"^TOTAL|^COMMENT|STATEMENT \(.*dkk\)|^BALANCE SHEET \(.*dkk\)|^INCOME STATEMENT \(.*dkk\)|^CASH-FLOW STATEMENT \(.*dkk\)|^$", case=False, regex=True)
        ]

        print(f"DEBUG: After improved filtering: {len(df)} records")

        # → LOOKUP real account_number / AccountKey for Income Statement and Balance Sheet entries
        df = df.merge(
            lookup,
            on=["mapping_description", "agreement_number"],
            how="left",
        )
        
        # Identify unmatched entries (likely Cash Flow entries)
        unmatched_mask = df["AccountKey"].isna()
        unmatched_count = unmatched_mask.sum()
        matched_df = df[~unmatched_mask].copy()
        unmatched_df = df[unmatched_mask].copy()
        
        print(f"  ℹ️  {len(matched_df)} entries matched with existing account mappings")
        print(f"  ℹ️  {unmatched_count} entries without mappings (likely Cash Flow entries)")

        # For unmatched entries, handle as Cash Flow entries with no AccountKey
        if unmatched_count > 0:
            print(f"  🔄 Processing {unmatched_count} entries without account mappings...")
            
            # Add section detection logic
            raw_full = pd.read_csv(budget_file, sep=";", header=2, dtype=str)
            raw_full.rename(columns={raw_full.columns[0]: "mapping_description"}, inplace=True)
            
            # Find section boundaries in the original CSV
            section_markers = {}
            for idx, row in raw_full.iterrows():
                desc = str(row["mapping_description"]).strip()
                if "INCOME STATEMENT" in desc.upper():
                    section_markers["income_start"] = idx
                elif "BALANCE SHEET" in desc.upper():
                    section_markers["balance_start"] = idx
                elif "CASH-FLOW STATEMENT" in desc.upper():
                    section_markers["cashflow_start"] = idx
            
            # Assign categories based on original CSV position
            def get_category_from_position(mapping_desc):
                # Find the original row index for this mapping_description
                matching_rows = raw_full[raw_full["mapping_description"] == mapping_desc]
                if matching_rows.empty:
                    return "Unknown"
                
                row_idx = matching_rows.index[0]
                
                # Determine section based on position
                if ("cashflow_start" in section_markers and 
                    row_idx >= section_markers["cashflow_start"]):
                    return "Cash Flow Statement"
                elif ("balance_start" in section_markers and 
                      row_idx >= section_markers["balance_start"]):
                    return "Balance Sheet"
                elif ("income_start" in section_markers and 
                      row_idx >= section_markers["income_start"]):
                    return "Income Statement"
                else:
                    return "Unknown"
            
            # Apply category detection
            unmatched_df["category"] = unmatched_df["mapping_description"].apply(get_category_from_position)
            
            # Only keep actual Cash Flow entries, filter out Balance Sheet entries
            cash_flow_entries = unmatched_df[unmatched_df["category"] == "Cash Flow Statement"].copy()
            
            if len(cash_flow_entries) > 0:
                cash_flow_entries["account_number"] = None
                cash_flow_entries["AccountKey"] = None
                cash_flow_entries["sub_category"] = "Cash Flow"
                
                print(f"  ✔️  Found {len(cash_flow_entries)} actual Cash Flow entries")
                print(f"  ❌  Filtered out {len(unmatched_df) - len(cash_flow_entries)} non-Cash Flow entries")
                
                # Combine matched and cash flow entries only
                df = pd.concat([matched_df, cash_flow_entries], ignore_index=True)
            else:
                print("  ⚠️  No Cash Flow entries found, using only matched entries")
                df = matched_df
            
            print(f"  ✔️  Final dataset has {len(df)} entries")

        # Ensure all required columns exist
        if "sub_category" not in df.columns:
            df["sub_category"] = None

        # Handle None values for Cash Flow entries
        df["account_number"] = df["account_number"].astype(str).replace('None', None)
        df["AccountKey"] = df["AccountKey"].replace('None', None)
        
        final_df = df[
            [
                "account_number",
                "mapping_description",
                "category",
                "sub_category",
                "year",
                "month",
                "amount",
                "agreement_number",
                "AccountKey",
            ]
        ]
        
        all_bud.append(final_df)
        print(f"✔  {bf}: kept {len(final_df)} budget rows ({len(matched_df)} mapped + {unmatched_count} Cash Flow)")
    except Exception:
        print(f"✖  {bf}:")
        traceback.print_exc()

if not all_bud:
    print("\n✖  No budget rows loaded – abort.")
    sys.exit(1)

bud_df = pd.concat(all_bud, ignore_index=True)

# Keep only one entry per mapping_description and agreement_number per month/year
# by dropping duplicates based on these fields
deduped_bud_df = bud_df.drop_duplicates(
    subset=['mapping_description', 'agreement_number', 'year', 'month']
)

with ENGINE.begin() as conn:
    conn.exec_driver_sql("TRUNCATE TABLE budget")
deduped_bud_df.to_sql("budget", ENGINE, if_exists="append", index=False)
print(f"\n✔  Loaded {len(deduped_bud_df)} rows into budget (after removing duplicates)")

print("\n✅  Import finished successfully.")
