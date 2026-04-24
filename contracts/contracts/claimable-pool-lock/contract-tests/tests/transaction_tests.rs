use ckb_testtool::{
    builtin::ALWAYS_SUCCESS,
    ckb_types::{bytes::Bytes, core::TransactionBuilder, packed::*, prelude::*},
    context::Context,
};
use std::{env, fs, path::PathBuf, str::FromStr};

const CAPACITY: u64 = 1_000_000_000;
const TEST_ENV_VAR: &str = "MODE";

enum TestEnv {
    Debug,
    Release,
}

impl FromStr for TestEnv {
    type Err = &'static str;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.to_lowercase().as_str() {
            "debug" => Ok(Self::Debug),
            "release" => Ok(Self::Release),
            _ => Err("unknown test env"),
        }
    }
}

impl TestEnv {
    fn build_dir_name(&self) -> &'static str {
        match self {
            Self::Debug => "debug",
            Self::Release => "release",
        }
    }
}

struct Loader {
    roots: Vec<PathBuf>,
}

impl Default for Loader {
    fn default() -> Self {
        let test_env = env::var(TEST_ENV_VAR)
            .ok()
            .map(|value| value.parse().expect("test env"))
            .unwrap_or(TestEnv::Release);
        Self::with_test_env(test_env)
    }
}

impl Loader {
    fn with_test_env(test_env: TestEnv) -> Self {
        let build_dir = test_env.build_dir_name();
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let mut roots = Vec::new();

        if let Ok(top) = env::var("TOP") {
            roots.push(PathBuf::from(top).join("build").join(build_dir));
        }

        roots.push(
            manifest_dir
                .join("..")
                .join("..")
                .join("..")
                .join("build")
                .join(build_dir),
        );
        roots.push(manifest_dir.join("..").join("build").join(build_dir));
        roots.push(manifest_dir.join("build").join(build_dir));

        if let Ok(current_dir) = env::current_dir() {
            roots.push(current_dir.join("build").join(build_dir));
            roots.push(current_dir.join("..").join("build").join(build_dir));
            roots.push(
                current_dir
                    .join("..")
                    .join("..")
                    .join("build")
                    .join(build_dir),
            );
            roots.push(
                current_dir
                    .join("..")
                    .join("..")
                    .join("..")
                    .join("build")
                    .join(build_dir),
            );
        }

        Self { roots }
    }

    fn load_binary(&self, name: &str) -> Bytes {
        for root in &self.roots {
            let path = root.join(name);
            if let Ok(bytes) = fs::read(&path) {
                return bytes.into();
            }
        }

        panic!(
            "Binary '{}' is missing. Searched roots: {:?}",
            name, self.roots
        );
    }
}

fn u128_data(amount: u128) -> Bytes {
    Bytes::from(amount.to_le_bytes().to_vec())
}

fn pool_data(entries: &[([u8; 32], u128)]) -> Bytes {
    let mut bytes = Vec::new();
    let total = entries
        .iter()
        .fold(0u128, |sum, (_, amount)| sum.checked_add(*amount).unwrap());
    bytes.extend_from_slice(&total.to_le_bytes());
    bytes.extend_from_slice(&(entries.len() as u32).to_le_bytes());
    for (claimant_lock_hash, amount) in entries {
        bytes.extend_from_slice(claimant_lock_hash);
        bytes.extend_from_slice(&amount.to_le_bytes());
    }
    Bytes::from(bytes)
}

fn lock_hash(script: &Script) -> [u8; 32] {
    script
        .calc_script_hash()
        .raw_data()
        .as_ref()
        .try_into()
        .unwrap()
}

struct ClaimableFixture {
    context: Context,
    pool_lock: Script,
    pool_lock_with_bad_args: Script,
    recycler_lock: Script,
    claimant_a_lock: Script,
    claimant_b_lock: Script,
    claimant_a_hash: [u8; 32],
    claimant_b_hash: [u8; 32],
    udt_type: Script,
    second_udt_type: Script,
}

impl ClaimableFixture {
    fn new() -> Self {
        let mut context = Context::default();

        let claimable_bin = Loader::default().load_binary("claimable-pool-lock");
        let claimable_out_point = context.deploy_cell(claimable_bin);

        let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());
        let claimant_a_lock = context
            .build_script(&always_success_out_point, Bytes::from(vec![1]))
            .expect("build claimant A lock");
        let claimant_b_lock = context
            .build_script(&always_success_out_point, Bytes::from(vec![2]))
            .expect("build claimant B lock");
        let recycler_lock = context
            .build_script(&always_success_out_point, Bytes::from(vec![9]))
            .expect("build recycler lock");
        let udt_type = context
            .build_script(&always_success_out_point, Bytes::from(b"mock-udt".to_vec()))
            .expect("build mock UDT type");
        let second_udt_type = context
            .build_script(
                &always_success_out_point,
                Bytes::from(b"mock-udt-2".to_vec()),
            )
            .expect("build second mock UDT type");

        let pool_lock = context
            .build_script(
                &claimable_out_point,
                Bytes::from(lock_hash(&recycler_lock).to_vec()),
            )
            .expect("build claimable pool lock");
        let pool_lock_with_bad_args = context
            .build_script(&claimable_out_point, Bytes::from(vec![1, 2, 3]))
            .expect("build claimable pool lock with bad args");
        let claimant_a_hash = lock_hash(&claimant_a_lock);
        let claimant_b_hash = lock_hash(&claimant_b_lock);

        Self {
            context,
            pool_lock,
            pool_lock_with_bad_args,
            recycler_lock,
            claimant_a_lock,
            claimant_b_lock,
            claimant_a_hash,
            claimant_b_hash,
            udt_type,
            second_udt_type,
        }
    }

    fn create_pool_cell(&mut self, entries: &[([u8; 32], u128)]) -> OutPoint {
        self.create_pool_cell_with_type(entries, self.udt_type.clone())
    }

    fn create_pool_cell_with_type(
        &mut self,
        entries: &[([u8; 32], u128)],
        type_script: Script,
    ) -> OutPoint {
        self.create_pool_cell_with_lock_and_type(entries, self.pool_lock.clone(), Some(type_script))
    }

    fn create_pool_cell_without_type(&mut self, entries: &[([u8; 32], u128)]) -> OutPoint {
        self.create_pool_cell_with_lock_and_type(entries, self.pool_lock.clone(), None)
    }

    fn create_pool_cell_with_bad_lock_args(&mut self, entries: &[([u8; 32], u128)]) -> OutPoint {
        self.create_pool_cell_with_lock_and_type(
            entries,
            self.pool_lock_with_bad_args.clone(),
            Some(self.udt_type.clone()),
        )
    }

    fn create_pool_cell_with_data(&mut self, data: Bytes) -> OutPoint {
        self.context.create_cell(
            CellOutput::new_builder()
                .capacity(CAPACITY.pack())
                .lock(self.pool_lock.clone())
                .type_(Some(self.udt_type.clone()).pack())
                .build(),
            data,
        )
    }

    fn create_pool_cell_with_lock_and_type(
        &mut self,
        entries: &[([u8; 32], u128)],
        lock: Script,
        type_script: Option<Script>,
    ) -> OutPoint {
        self.context.create_cell(
            CellOutput::new_builder()
                .capacity(CAPACITY.pack())
                .lock(lock)
                .type_(type_script.pack())
                .build(),
            pool_data(entries),
        )
    }

    fn create_auth_cell(&mut self, lock: Script) -> OutPoint {
        self.context.create_cell(
            CellOutput::new_builder()
                .capacity(CAPACITY.pack())
                .lock(lock)
                .build(),
            Bytes::new(),
        )
    }

    fn pool_output(&self, entries: &[([u8; 32], u128)]) -> (CellOutput, Bytes) {
        self.pool_output_with_capacity(entries, CAPACITY)
    }

    fn pool_output_with_capacity(
        &self,
        entries: &[([u8; 32], u128)],
        capacity: u64,
    ) -> (CellOutput, Bytes) {
        self.pool_output_with_type(entries, capacity, self.udt_type.clone())
    }

    fn pool_output_with_type(
        &self,
        entries: &[([u8; 32], u128)],
        capacity: u64,
        type_script: Script,
    ) -> (CellOutput, Bytes) {
        self.pool_output_with_optional_type(
            entries,
            capacity,
            Some(type_script),
            pool_data(entries),
        )
    }

    fn pool_output_without_type(&self, entries: &[([u8; 32], u128)]) -> (CellOutput, Bytes) {
        self.pool_output_with_optional_type(entries, CAPACITY, None, pool_data(entries))
    }

    fn pool_output_with_data(&self, data: Bytes) -> (CellOutput, Bytes) {
        self.pool_output_with_optional_type(&[], CAPACITY, Some(self.udt_type.clone()), data)
    }

    fn pool_output_with_optional_type(
        &self,
        _entries: &[([u8; 32], u128)],
        capacity: u64,
        type_script: Option<Script>,
        data: Bytes,
    ) -> (CellOutput, Bytes) {
        (
            CellOutput::new_builder()
                .capacity(capacity.pack())
                .lock(self.pool_lock.clone())
                .type_(type_script.pack())
                .build(),
            data,
        )
    }

    fn claimant_output(&self, lock: Script, amount: u128) -> (CellOutput, Bytes) {
        self.claimant_output_with_type(lock, amount, self.udt_type.clone())
    }

    fn claimant_output_with_type(
        &self,
        lock: Script,
        amount: u128,
        type_script: Script,
    ) -> (CellOutput, Bytes) {
        (
            CellOutput::new_builder()
                .capacity(CAPACITY.pack())
                .lock(lock)
                .type_(Some(type_script).pack())
                .build(),
            u128_data(amount),
        )
    }

    fn claimant_cell_with_type_and_data(
        &mut self,
        lock: Script,
        type_script: Script,
        data: Bytes,
    ) -> OutPoint {
        self.context.create_cell(
            CellOutput::new_builder()
                .capacity(CAPACITY.pack())
                .lock(lock)
                .type_(Some(type_script).pack())
                .build(),
            data,
        )
    }
}

#[test]
fn recycles_pool_cell_with_recycler_input() {
    let mut fixture = ClaimableFixture::new();
    let pool_out_point = fixture.create_pool_cell(&[(fixture.claimant_a_hash, 100)]);
    let recycler_out_point = fixture.create_auth_cell(fixture.recycler_lock.clone());
    let (recycled_output, recycled_output_data) =
        fixture.claimant_output(fixture.recycler_lock.clone(), 100);

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(pool_out_point)
                .build(),
        )
        .input(
            CellInput::new_builder()
                .previous_output(recycler_out_point)
                .build(),
        )
        .output(recycled_output)
        .output_data(recycled_output_data.pack())
        .build();
    let tx = fixture.context.complete_tx(tx);

    fixture
        .context
        .verify_tx(&tx, 10_000_000)
        .expect("authorized recycle should pass");
}

#[test]
fn recycles_multiple_pool_cells_with_recycler_input() {
    let mut fixture = ClaimableFixture::new();
    let pool_a_out_point = fixture.create_pool_cell(&[(fixture.claimant_a_hash, 100)]);
    let pool_b_out_point = fixture.create_pool_cell(&[(fixture.claimant_b_hash, 250)]);
    let recycler_out_point = fixture.create_auth_cell(fixture.recycler_lock.clone());
    let (recycled_output, recycled_output_data) =
        fixture.claimant_output(fixture.recycler_lock.clone(), 350);

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(pool_a_out_point)
                .build(),
        )
        .input(
            CellInput::new_builder()
                .previous_output(pool_b_out_point)
                .build(),
        )
        .input(
            CellInput::new_builder()
                .previous_output(recycler_out_point)
                .build(),
        )
        .output(recycled_output)
        .output_data(recycled_output_data.pack())
        .build();
    let tx = fixture.context.complete_tx(tx);

    fixture
        .context
        .verify_tx(&tx, 10_000_000)
        .expect("authorized batched recycle should pass");
}

#[test]
fn rejects_recycle_without_recycler_input() {
    let mut fixture = ClaimableFixture::new();
    let pool_out_point = fixture.create_pool_cell(&[(fixture.claimant_a_hash, 100)]);
    let (recycled_output, recycled_output_data) =
        fixture.claimant_output(fixture.claimant_a_lock.clone(), 100);

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(pool_out_point)
                .build(),
        )
        .output(recycled_output)
        .output_data(recycled_output_data.pack())
        .build();
    let tx = fixture.context.complete_tx(tx);

    assert!(fixture.context.verify_tx(&tx, 10_000_000).is_err());
}

#[test]
fn rejects_recycle_path_when_pool_output_remains() {
    let mut fixture = ClaimableFixture::new();
    let pool_out_point = fixture.create_pool_cell(&[(fixture.claimant_a_hash, 100)]);
    let recycler_out_point = fixture.create_auth_cell(fixture.recycler_lock.clone());
    let (pool_output, pool_output_data) = fixture.pool_output(&[(fixture.claimant_a_hash, 100)]);

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(pool_out_point)
                .build(),
        )
        .input(
            CellInput::new_builder()
                .previous_output(recycler_out_point)
                .build(),
        )
        .output(pool_output)
        .output_data(pool_output_data.pack())
        .build();
    let tx = fixture.context.complete_tx(tx);

    assert!(fixture.context.verify_tx(&tx, 10_000_000).is_err());
}

#[test]
fn rejects_claim_with_decreased_pool_capacity() {
    let mut fixture = ClaimableFixture::new();
    let pool_out_point = fixture.create_pool_cell(&[(fixture.claimant_a_hash, 100)]);
    let auth_out_point = fixture.create_auth_cell(fixture.claimant_a_lock.clone());
    let (pool_output, pool_output_data) =
        fixture.pool_output_with_capacity(&[], CAPACITY.saturating_sub(1));
    let (claim_output, claim_output_data) =
        fixture.claimant_output(fixture.claimant_a_lock.clone(), 100);

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(pool_out_point)
                .build(),
        )
        .input(
            CellInput::new_builder()
                .previous_output(auth_out_point)
                .build(),
        )
        .output(pool_output)
        .output(claim_output)
        .output_data(pool_output_data.pack())
        .output_data(claim_output_data.pack())
        .build();
    let tx = fixture.context.complete_tx(tx);

    assert!(fixture.context.verify_tx(&tx, 10_000_000).is_err());
}

#[test]
fn rejects_claim_with_changed_pool_type() {
    let mut fixture = ClaimableFixture::new();
    let pool_out_point = fixture.create_pool_cell(&[(fixture.claimant_a_hash, 100)]);
    let auth_out_point = fixture.create_auth_cell(fixture.claimant_a_lock.clone());
    let (pool_output, pool_output_data) =
        fixture.pool_output_with_type(&[], CAPACITY, fixture.claimant_a_lock.clone());
    let (claim_output, claim_output_data) =
        fixture.claimant_output(fixture.claimant_a_lock.clone(), 100);

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(pool_out_point)
                .build(),
        )
        .input(
            CellInput::new_builder()
                .previous_output(auth_out_point)
                .build(),
        )
        .output(pool_output)
        .output(claim_output)
        .output_data(pool_output_data.pack())
        .output_data(claim_output_data.pack())
        .build();
    let tx = fixture.context.complete_tx(tx);

    assert!(fixture.context.verify_tx(&tx, 10_000_000).is_err());
}

#[test]
fn rejects_claim_with_missing_input_type() {
    let mut fixture = ClaimableFixture::new();
    let pool_out_point = fixture.create_pool_cell_without_type(&[(fixture.claimant_a_hash, 100)]);
    let auth_out_point = fixture.create_auth_cell(fixture.claimant_a_lock.clone());
    let (pool_output, pool_output_data) = fixture.pool_output(&[]);
    let (claim_output, claim_output_data) =
        fixture.claimant_output(fixture.claimant_a_lock.clone(), 100);

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(pool_out_point)
                .build(),
        )
        .input(
            CellInput::new_builder()
                .previous_output(auth_out_point)
                .build(),
        )
        .output(pool_output)
        .output(claim_output)
        .output_data(pool_output_data.pack())
        .output_data(claim_output_data.pack())
        .build();
    let tx = fixture.context.complete_tx(tx);

    assert!(fixture.context.verify_tx(&tx, 10_000_000).is_err());
}

#[test]
fn rejects_claim_with_missing_output_type() {
    let mut fixture = ClaimableFixture::new();
    let pool_out_point = fixture.create_pool_cell(&[(fixture.claimant_a_hash, 100)]);
    let auth_out_point = fixture.create_auth_cell(fixture.claimant_a_lock.clone());
    let (pool_output, pool_output_data) = fixture.pool_output_without_type(&[]);
    let (claim_output, claim_output_data) =
        fixture.claimant_output(fixture.claimant_a_lock.clone(), 100);

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(pool_out_point)
                .build(),
        )
        .input(
            CellInput::new_builder()
                .previous_output(auth_out_point)
                .build(),
        )
        .output(pool_output)
        .output(claim_output)
        .output_data(pool_output_data.pack())
        .output_data(claim_output_data.pack())
        .build();
    let tx = fixture.context.complete_tx(tx);

    assert!(fixture.context.verify_tx(&tx, 10_000_000).is_err());
}

#[test]
fn rejects_pool_lock_with_invalid_args_length() {
    let mut fixture = ClaimableFixture::new();
    let pool_out_point =
        fixture.create_pool_cell_with_bad_lock_args(&[(fixture.claimant_a_hash, 100)]);
    let recycler_out_point = fixture.create_auth_cell(fixture.recycler_lock.clone());
    let (recycled_output, recycled_output_data) =
        fixture.claimant_output(fixture.recycler_lock.clone(), 100);

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(pool_out_point)
                .build(),
        )
        .input(
            CellInput::new_builder()
                .previous_output(recycler_out_point)
                .build(),
        )
        .output(recycled_output)
        .output_data(recycled_output_data.pack())
        .build();
    let tx = fixture.context.complete_tx(tx);

    assert!(fixture.context.verify_tx(&tx, 10_000_000).is_err());
}

#[test]
fn rejects_claim_with_malformed_output_pool_data() {
    let mut fixture = ClaimableFixture::new();
    let pool_out_point = fixture.create_pool_cell(&[(fixture.claimant_a_hash, 100)]);
    let auth_out_point = fixture.create_auth_cell(fixture.claimant_a_lock.clone());
    let (pool_output, pool_output_data) = fixture.pool_output_with_data(Bytes::from(vec![0u8; 15]));
    let (claim_output, claim_output_data) =
        fixture.claimant_output(fixture.claimant_a_lock.clone(), 100);

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(pool_out_point)
                .build(),
        )
        .input(
            CellInput::new_builder()
                .previous_output(auth_out_point)
                .build(),
        )
        .output(pool_output)
        .output(claim_output)
        .output_data(pool_output_data.pack())
        .output_data(claim_output_data.pack())
        .build();
    let tx = fixture.context.complete_tx(tx);

    assert!(fixture.context.verify_tx(&tx, 10_000_000).is_err());
}

#[test]
fn rejects_claim_with_malformed_input_pool_data() {
    let mut fixture = ClaimableFixture::new();
    let pool_out_point = fixture.create_pool_cell_with_data(Bytes::from(vec![0u8; 15]));
    let auth_out_point = fixture.create_auth_cell(fixture.claimant_a_lock.clone());
    let (pool_output, pool_output_data) = fixture.pool_output(&[]);
    let (claim_output, claim_output_data) =
        fixture.claimant_output(fixture.claimant_a_lock.clone(), 100);

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(pool_out_point)
                .build(),
        )
        .input(
            CellInput::new_builder()
                .previous_output(auth_out_point)
                .build(),
        )
        .output(pool_output)
        .output(claim_output)
        .output_data(pool_output_data.pack())
        .output_data(claim_output_data.pack())
        .build();
    let tx = fixture.context.complete_tx(tx);

    assert!(fixture.context.verify_tx(&tx, 10_000_000).is_err());
}

#[test]
fn claims_single_pool_cell() {
    let mut fixture = ClaimableFixture::new();
    let pool_out_point = fixture.create_pool_cell(&[(fixture.claimant_a_hash, 100)]);
    let auth_out_point = fixture.create_auth_cell(fixture.claimant_a_lock.clone());
    let (pool_output, pool_output_data) = fixture.pool_output(&[]);
    let (claim_output, claim_output_data) =
        fixture.claimant_output(fixture.claimant_a_lock.clone(), 100);

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(pool_out_point)
                .build(),
        )
        .input(
            CellInput::new_builder()
                .previous_output(auth_out_point)
                .build(),
        )
        .output(pool_output)
        .output(claim_output)
        .output_data(pool_output_data.pack())
        .output_data(claim_output_data.pack())
        .build();
    let tx = fixture.context.complete_tx(tx);

    fixture
        .context
        .verify_tx(&tx, 10_000_000)
        .expect("authorized claim should pass");
}

#[test]
fn claims_with_existing_claimant_udt_balance() {
    let mut fixture = ClaimableFixture::new();
    let pool_out_point = fixture.create_pool_cell(&[(fixture.claimant_a_hash, 100)]);
    let existing_udt_out_point = fixture.claimant_cell_with_type_and_data(
        fixture.claimant_a_lock.clone(),
        fixture.udt_type.clone(),
        u128_data(50),
    );
    let (pool_output, pool_output_data) = fixture.pool_output(&[]);
    let (claim_output, claim_output_data) =
        fixture.claimant_output(fixture.claimant_a_lock.clone(), 150);

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(pool_out_point)
                .build(),
        )
        .input(
            CellInput::new_builder()
                .previous_output(existing_udt_out_point)
                .build(),
        )
        .output(pool_output)
        .output(claim_output)
        .output_data(pool_output_data.pack())
        .output_data(claim_output_data.pack())
        .build();
    let tx = fixture.context.complete_tx(tx);

    fixture
        .context
        .verify_tx(&tx, 10_000_000)
        .expect("claim should add to existing claimant UDT balance");
}

#[test]
fn rejects_claim_sent_to_wrong_lock() {
    let mut fixture = ClaimableFixture::new();
    let pool_out_point = fixture.create_pool_cell(&[(fixture.claimant_a_hash, 100)]);
    let auth_out_point = fixture.create_auth_cell(fixture.claimant_a_lock.clone());
    let (pool_output, pool_output_data) = fixture.pool_output(&[]);
    let (wrong_claim_output, wrong_claim_output_data) =
        fixture.claimant_output(fixture.claimant_b_lock.clone(), 100);

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(pool_out_point)
                .build(),
        )
        .input(
            CellInput::new_builder()
                .previous_output(auth_out_point)
                .build(),
        )
        .output(pool_output)
        .output(wrong_claim_output)
        .output_data(pool_output_data.pack())
        .output_data(wrong_claim_output_data.pack())
        .build();
    let tx = fixture.context.complete_tx(tx);

    assert!(fixture.context.verify_tx(&tx, 10_000_000).is_err());
}

#[test]
fn rejects_claim_with_overpaid_output_amount() {
    let mut fixture = ClaimableFixture::new();
    let pool_out_point = fixture.create_pool_cell(&[(fixture.claimant_a_hash, 100)]);
    let auth_out_point = fixture.create_auth_cell(fixture.claimant_a_lock.clone());
    let (pool_output, pool_output_data) = fixture.pool_output(&[]);
    let (claim_output, claim_output_data) =
        fixture.claimant_output(fixture.claimant_a_lock.clone(), 101);

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(pool_out_point)
                .build(),
        )
        .input(
            CellInput::new_builder()
                .previous_output(auth_out_point)
                .build(),
        )
        .output(pool_output)
        .output(claim_output)
        .output_data(pool_output_data.pack())
        .output_data(claim_output_data.pack())
        .build();
    let tx = fixture.context.complete_tx(tx);

    assert!(fixture.context.verify_tx(&tx, 10_000_000).is_err());
}

#[test]
fn rejects_claim_with_wrong_output_amount() {
    let mut fixture = ClaimableFixture::new();
    let pool_out_point = fixture.create_pool_cell(&[(fixture.claimant_a_hash, 100)]);
    let auth_out_point = fixture.create_auth_cell(fixture.claimant_a_lock.clone());
    let (pool_output, pool_output_data) = fixture.pool_output(&[]);
    let (claim_output, claim_output_data) =
        fixture.claimant_output(fixture.claimant_a_lock.clone(), 99);

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(pool_out_point)
                .build(),
        )
        .input(
            CellInput::new_builder()
                .previous_output(auth_out_point)
                .build(),
        )
        .output(pool_output)
        .output(claim_output)
        .output_data(pool_output_data.pack())
        .output_data(claim_output_data.pack())
        .build();
    let tx = fixture.context.complete_tx(tx);

    assert!(fixture.context.verify_tx(&tx, 10_000_000).is_err());
}

#[test]
fn rejects_claim_when_existing_claimant_udt_data_is_short() {
    let mut fixture = ClaimableFixture::new();
    let pool_out_point = fixture.create_pool_cell(&[(fixture.claimant_a_hash, 100)]);
    let malformed_existing_udt_out_point = fixture.claimant_cell_with_type_and_data(
        fixture.claimant_a_lock.clone(),
        fixture.udt_type.clone(),
        Bytes::from(vec![0u8; 15]),
    );
    let (pool_output, pool_output_data) = fixture.pool_output(&[]);
    let (claim_output, claim_output_data) =
        fixture.claimant_output(fixture.claimant_a_lock.clone(), 100);

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(pool_out_point)
                .build(),
        )
        .input(
            CellInput::new_builder()
                .previous_output(malformed_existing_udt_out_point)
                .build(),
        )
        .output(pool_output)
        .output(claim_output)
        .output_data(pool_output_data.pack())
        .output_data(claim_output_data.pack())
        .build();
    let tx = fixture.context.complete_tx(tx);

    assert!(fixture.context.verify_tx(&tx, 10_000_000).is_err());
}

#[test]
fn claims_pool_cell_when_pool_output_is_not_output_zero() {
    let mut fixture = ClaimableFixture::new();
    let pool_out_point = fixture.create_pool_cell(&[(fixture.claimant_a_hash, 100)]);
    let auth_out_point = fixture.create_auth_cell(fixture.claimant_a_lock.clone());
    let (pool_output, pool_output_data) = fixture.pool_output(&[]);
    let (claim_output, claim_output_data) =
        fixture.claimant_output(fixture.claimant_a_lock.clone(), 100);

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(pool_out_point)
                .build(),
        )
        .input(
            CellInput::new_builder()
                .previous_output(auth_out_point)
                .build(),
        )
        .output(claim_output)
        .output(pool_output)
        .output_data(claim_output_data.pack())
        .output_data(pool_output_data.pack())
        .build();
    let tx = fixture.context.complete_tx(tx);

    fixture
        .context
        .verify_tx(&tx, 10_000_000)
        .expect("authorized claim should find non-zero pool output index");
}

#[test]
fn claims_same_claimant_from_multiple_pool_cells() {
    let mut fixture = ClaimableFixture::new();
    let pool_a_out_point = fixture.create_pool_cell(&[(fixture.claimant_a_hash, 100)]);
    let pool_b_out_point = fixture.create_pool_cell(&[(fixture.claimant_a_hash, 60)]);
    let auth_a_out_point = fixture.create_auth_cell(fixture.claimant_a_lock.clone());
    let (pool_a_output, pool_a_output_data) = fixture.pool_output(&[]);
    let (pool_b_output, pool_b_output_data) = fixture.pool_output(&[]);
    let (claim_output, claim_output_data) =
        fixture.claimant_output(fixture.claimant_a_lock.clone(), 160);

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(pool_a_out_point)
                .build(),
        )
        .input(
            CellInput::new_builder()
                .previous_output(pool_b_out_point)
                .build(),
        )
        .input(
            CellInput::new_builder()
                .previous_output(auth_a_out_point)
                .build(),
        )
        .output(pool_a_output)
        .output(pool_b_output)
        .output(claim_output)
        .output_data(pool_a_output_data.pack())
        .output_data(pool_b_output_data.pack())
        .output_data(claim_output_data.pack())
        .build();
    let tx = fixture.context.complete_tx(tx);

    fixture
        .context
        .verify_tx(&tx, 10_000_000)
        .expect("same claimant claims should aggregate across pool cells");
}

#[test]
fn claims_same_claimant_from_multiple_udt_types() {
    let mut fixture = ClaimableFixture::new();
    let pool_a_out_point = fixture.create_pool_cell(&[(fixture.claimant_a_hash, 100)]);
    let pool_b_out_point = fixture.create_pool_cell_with_type(
        &[(fixture.claimant_a_hash, 250)],
        fixture.second_udt_type.clone(),
    );
    let auth_a_out_point = fixture.create_auth_cell(fixture.claimant_a_lock.clone());
    let (pool_a_output, pool_a_output_data) = fixture.pool_output(&[]);
    let (pool_b_output, pool_b_output_data) =
        fixture.pool_output_with_type(&[], CAPACITY, fixture.second_udt_type.clone());
    let (claim_a_output, claim_a_output_data) =
        fixture.claimant_output(fixture.claimant_a_lock.clone(), 100);
    let (claim_b_output, claim_b_output_data) = fixture.claimant_output_with_type(
        fixture.claimant_a_lock.clone(),
        250,
        fixture.second_udt_type.clone(),
    );

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(pool_a_out_point)
                .build(),
        )
        .input(
            CellInput::new_builder()
                .previous_output(pool_b_out_point)
                .build(),
        )
        .input(
            CellInput::new_builder()
                .previous_output(auth_a_out_point)
                .build(),
        )
        .output(pool_a_output)
        .output(pool_b_output)
        .output(claim_a_output)
        .output(claim_b_output)
        .output_data(pool_a_output_data.pack())
        .output_data(pool_b_output_data.pack())
        .output_data(claim_a_output_data.pack())
        .output_data(claim_b_output_data.pack())
        .build();
    let tx = fixture.context.complete_tx(tx);

    fixture
        .context
        .verify_tx(&tx, 10_000_000)
        .expect("same claimant claims should stay separated by UDT type");
}

#[test]
fn rejects_multi_claim_when_one_claimant_input_is_missing() {
    let mut fixture = ClaimableFixture::new();
    let pool_out_point = fixture.create_pool_cell(&[
        (fixture.claimant_a_hash, 100),
        (fixture.claimant_b_hash, 250),
    ]);
    let auth_a_out_point = fixture.create_auth_cell(fixture.claimant_a_lock.clone());
    let (pool_output, pool_output_data) = fixture.pool_output(&[]);
    let (claim_a_output, claim_a_output_data) =
        fixture.claimant_output(fixture.claimant_a_lock.clone(), 100);
    let (claim_b_output, claim_b_output_data) =
        fixture.claimant_output(fixture.claimant_b_lock.clone(), 250);

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(pool_out_point)
                .build(),
        )
        .input(
            CellInput::new_builder()
                .previous_output(auth_a_out_point)
                .build(),
        )
        .output(pool_output)
        .output(claim_a_output)
        .output(claim_b_output)
        .output_data(pool_output_data.pack())
        .output_data(claim_a_output_data.pack())
        .output_data(claim_b_output_data.pack())
        .build();
    let tx = fixture.context.complete_tx(tx);

    assert!(fixture.context.verify_tx(&tx, 10_000_000).is_err());
}

#[test]
fn rejects_claim_without_claimant_input() {
    let mut fixture = ClaimableFixture::new();
    let pool_out_point = fixture.create_pool_cell(&[(fixture.claimant_a_hash, 100)]);
    let (pool_output, pool_output_data) = fixture.pool_output(&[]);
    let (claim_output, claim_output_data) =
        fixture.claimant_output(fixture.claimant_a_lock.clone(), 100);

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(pool_out_point)
                .build(),
        )
        .output(pool_output)
        .output(claim_output)
        .output_data(pool_output_data.pack())
        .output_data(claim_output_data.pack())
        .build();
    let tx = fixture.context.complete_tx(tx);

    assert!(fixture.context.verify_tx(&tx, 10_000_000).is_err());
}

#[test]
fn rejects_claiming_one_pool_while_recycling_another_pool() {
    let mut fixture = ClaimableFixture::new();
    let pool_a_out_point = fixture.create_pool_cell(&[(fixture.claimant_a_hash, 100)]);
    let pool_b_out_point = fixture.create_pool_cell(&[(fixture.claimant_b_hash, 250)]);
    let auth_a_out_point = fixture.create_auth_cell(fixture.claimant_a_lock.clone());
    let recycler_out_point = fixture.create_auth_cell(fixture.recycler_lock.clone());
    let (pool_a_output, pool_a_output_data) = fixture.pool_output(&[]);
    let (claim_a_output, claim_a_output_data) =
        fixture.claimant_output(fixture.claimant_a_lock.clone(), 100);

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(pool_a_out_point)
                .build(),
        )
        .input(
            CellInput::new_builder()
                .previous_output(pool_b_out_point)
                .build(),
        )
        .input(
            CellInput::new_builder()
                .previous_output(auth_a_out_point)
                .build(),
        )
        .input(
            CellInput::new_builder()
                .previous_output(recycler_out_point)
                .build(),
        )
        .output(pool_a_output)
        .output(claim_a_output)
        .output_data(pool_a_output_data.pack())
        .output_data(claim_a_output_data.pack())
        .build();
    let tx = fixture.context.complete_tx(tx);

    assert!(fixture.context.verify_tx(&tx, 10_000_000).is_err());
}

#[test]
fn rejects_partial_claim_for_same_claimant() {
    let mut fixture = ClaimableFixture::new();
    let pool_out_point =
        fixture.create_pool_cell(&[(fixture.claimant_a_hash, 60), (fixture.claimant_a_hash, 40)]);
    let auth_out_point = fixture.create_auth_cell(fixture.claimant_a_lock.clone());
    let (pool_output, pool_output_data) = fixture.pool_output(&[(fixture.claimant_a_hash, 40)]);
    let (claim_output, claim_output_data) =
        fixture.claimant_output(fixture.claimant_a_lock.clone(), 60);

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(pool_out_point)
                .build(),
        )
        .input(
            CellInput::new_builder()
                .previous_output(auth_out_point)
                .build(),
        )
        .output(pool_output)
        .output(claim_output)
        .output_data(pool_output_data.pack())
        .output_data(claim_output_data.pack())
        .build();
    let tx = fixture.context.complete_tx(tx);

    assert!(fixture.context.verify_tx(&tx, 10_000_000).is_err());
}

#[test]
fn rejects_splitting_one_pool_input_into_multiple_pool_outputs() {
    let mut fixture = ClaimableFixture::new();
    let pool_out_point = fixture.create_pool_cell(&[(fixture.claimant_a_hash, 100)]);
    let auth_out_point = fixture.create_auth_cell(fixture.claimant_a_lock.clone());
    let (pool_output_a, pool_output_a_data) = fixture.pool_output(&[]);
    let (pool_output_b, pool_output_b_data) = fixture.pool_output(&[]);
    let (claim_output, claim_output_data) =
        fixture.claimant_output(fixture.claimant_a_lock.clone(), 100);

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(pool_out_point)
                .build(),
        )
        .input(
            CellInput::new_builder()
                .previous_output(auth_out_point)
                .build(),
        )
        .output(pool_output_a)
        .output(pool_output_b)
        .output(claim_output)
        .output_data(pool_output_a_data.pack())
        .output_data(pool_output_b_data.pack())
        .output_data(claim_output_data.pack())
        .build();
    let tx = fixture.context.complete_tx(tx);

    assert!(fixture.context.verify_tx(&tx, 10_000_000).is_err());
}

#[test]
fn claims_multiple_pool_cells_in_one_transaction() {
    let mut fixture = ClaimableFixture::new();
    let pool_a_out_point = fixture.create_pool_cell(&[(fixture.claimant_a_hash, 100)]);
    let pool_b_out_point = fixture.create_pool_cell(&[(fixture.claimant_b_hash, 250)]);
    let auth_a_out_point = fixture.create_auth_cell(fixture.claimant_a_lock.clone());
    let auth_b_out_point = fixture.create_auth_cell(fixture.claimant_b_lock.clone());
    let (pool_a_output, pool_a_output_data) = fixture.pool_output(&[]);
    let (pool_b_output, pool_b_output_data) = fixture.pool_output(&[]);
    let (claim_a_output, claim_a_output_data) =
        fixture.claimant_output(fixture.claimant_a_lock.clone(), 100);
    let (claim_b_output, claim_b_output_data) =
        fixture.claimant_output(fixture.claimant_b_lock.clone(), 250);

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(pool_a_out_point)
                .build(),
        )
        .input(
            CellInput::new_builder()
                .previous_output(pool_b_out_point)
                .build(),
        )
        .input(
            CellInput::new_builder()
                .previous_output(auth_a_out_point)
                .build(),
        )
        .input(
            CellInput::new_builder()
                .previous_output(auth_b_out_point)
                .build(),
        )
        .output(pool_a_output)
        .output(pool_b_output)
        .output(claim_a_output)
        .output(claim_b_output)
        .output_data(pool_a_output_data.pack())
        .output_data(pool_b_output_data.pack())
        .output_data(claim_a_output_data.pack())
        .output_data(claim_b_output_data.pack())
        .build();
    let tx = fixture.context.complete_tx(tx);

    fixture
        .context
        .verify_tx(&tx, 10_000_000)
        .expect("batched authorized claims should pass");
}
