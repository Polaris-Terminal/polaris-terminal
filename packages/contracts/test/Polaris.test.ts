import { expect } from "chai";
import hre from "hardhat";
import { upgrades } from "@openzeppelin/hardhat-upgrades";

const connection = await hre.network.create();
const { ethers, networkHelpers } = connection;
const upgradesApi = await upgrades(hre, connection);
const DAY = 86_400;
const usd = (n: number) => ethers.parseUnits(String(n), 6);

async function deploy() {
  const [owner, alice, bob] = await ethers.getSigners();
  const proxy = async (name: string, args: unknown[]) => {
    const c = await upgradesApi.deployProxy(await ethers.getContractFactory(name), args, { kind: "uups" });
    await c.waitForDeployment();
    return ethers.getContractAt(name, await c.getAddress());
  };
  const token = await proxy("PolarisToken", [owner.address, ethers.parseEther("1000000000")]);
  const dollar = await proxy("PolarisDollar", [owner.address, usd(10_000), DAY]);
  const vault = await proxy("PolarisVault", [await dollar.getAddress(), "North Vault", "nvUSD", owner.address]);
  const registry = await proxy("PolarisRegistry", [owner.address, await dollar.getAddress()]);
  const beacon = await proxy("PolarisBeacon", [owner.address, await token.getAddress(), ethers.parseEther("1000")]);
  return { owner, alice, bob, token, dollar, vault, registry, beacon };
}

describe("PolarisToken", () => {
  it("mints the fixed supply to the owner and only the owner can upgrade", async () => {
    const { owner, alice, token } = await deploy();
    expect(await token.symbol()).to.equal("POLARIS");
    expect(await token.balanceOf(owner.address)).to.equal(ethers.parseEther("1000000000"));
    const impl = await (await ethers.getContractFactory("PolarisToken")).deploy();
    await expect(token.connect(alice).upgradeToAndCall(await impl.getAddress(), "0x"))
      .to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
  });
});

describe("PolarisDollar", () => {
  it("drips once per cooldown", async () => {
    const { alice, dollar } = await deploy();
    await dollar.connect(alice).drip();
    expect(await dollar.balanceOf(alice.address)).to.equal(usd(10_000));
    await expect(dollar.connect(alice).drip()).to.be.revertedWithCustomError(dollar, "DripCooling");
    await networkHelpers.time.increase(DAY);
    await dollar.connect(alice).drip();
    expect(await dollar.balanceOf(alice.address)).to.equal(usd(20_000));
  });
});

describe("PolarisVault", () => {
  it("streams rewards linearly into the share price", async () => {
    const { owner, alice, dollar, vault } = await deploy();
    await dollar.mint(alice.address, usd(1_000));
    await dollar.connect(alice).approve(await vault.getAddress(), usd(1_000));
    await vault.connect(alice).deposit(usd(1_000), alice.address);

    await dollar.mint(owner.address, usd(100));
    await dollar.approve(await vault.getAddress(), usd(100));
    await vault.streamReward(usd(100), 10 * DAY);
    expect(await vault.totalAssets()).to.be.closeTo(usd(1_000), usd(1)); // nothing vested yet

    await networkHelpers.time.increase(5 * DAY);
    expect(await vault.totalAssets()).to.be.closeTo(usd(1_050), usd(1));

    await networkHelpers.time.increase(5 * DAY);
    const shares = await vault.balanceOf(alice.address);
    await vault.connect(alice).redeem(shares, alice.address, alice.address);
    expect(await dollar.balanceOf(alice.address)).to.be.closeTo(usd(1_100), usd(1));
  });

  it("pausing blocks deposits but never withdrawals", async () => {
    const { alice, dollar, vault } = await deploy();
    await dollar.mint(alice.address, usd(10));
    await dollar.connect(alice).approve(await vault.getAddress(), usd(10));
    await vault.connect(alice).deposit(usd(5), alice.address);
    await vault.pause();
    await expect(vault.connect(alice).deposit(usd(5), alice.address))
      .to.be.revertedWithCustomError(vault, "ERC4626ExceededMaxDeposit");
    await vault.connect(alice).withdraw(usd(5), alice.address, alice.address);
  });
});

describe("PolarisRegistry", () => {
  it("lists only vaults that hold the registry asset", async () => {
    const { registry, vault, token } = await deploy();
    await registry.listVault(await vault.getAddress(), "North Vault", "Polaris Labs");
    expect(await registry.isActive(await vault.getAddress())).to.equal(true);
    await expect(registry.listVault(await vault.getAddress(), "x", "y"))
      .to.be.revertedWithCustomError(registry, "AlreadyListed");

    const wrong = await upgradesApi.deployProxy(await ethers.getContractFactory("PolarisVault"),
      [await token.getAddress(), "Wrong", "w", (await ethers.getSigners())[0].address], { kind: "uups" });
    await expect(registry.listVault(await wrong.getAddress(), "Wrong", "x"))
      .to.be.revertedWithCustomError(registry, "AssetMismatch");

    await registry.setActive(await vault.getAddress(), false);
    expect((await registry.vaults())[0].active).to.equal(false);
  });
});

describe("PolarisBeacon", () => {
  it("builds streaks, resets on a missed day, and boosts holders", async () => {
    const { owner, alice, beacon } = await deploy();
    await beacon.connect(alice).ping();
    await expect(beacon.connect(alice).ping()).to.be.revertedWithCustomError(beacon, "AlreadyPinged");
    await networkHelpers.time.increase(DAY);
    await beacon.connect(alice).ping();
    let s = await beacon.stars(alice.address);
    expect(s.streak).to.equal(2n);
    expect(s.xp).to.equal(25n); // 10 + (10 + 5)

    await networkHelpers.time.increase(3 * DAY);
    expect(await beacon.liveStreak(alice.address)).to.equal(0n);
    await beacon.connect(alice).ping();
    s = await beacon.stars(alice.address);
    expect(s.streak).to.equal(1n);
    expect(s.best).to.equal(2n);

    await beacon.connect(owner).ping(); // owner holds the whole $POLARIS supply
    expect((await beacon.stars(owner.address)).xp).to.equal(15n);
    expect(await beacon.observers()).to.equal(2n);
  });
});

describe("Upgrades", () => {
  it("keeps state across an upgrade", async () => {
    const { alice, beacon } = await deploy();
    await beacon.connect(alice).ping();
    const upgraded = await upgradesApi.upgradeProxy(await beacon.getAddress(),
      await ethers.getContractFactory("PolarisBeacon"), { redeployImplementation: "always" });
    expect((await upgraded.stars(alice.address)).pings).to.equal(1n);
  });
});
