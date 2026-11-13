import { CONFIG, $, $$, boot, smoothScroll, esc, explorerAddr } from "./core.js";

boot();
$$("[data-net-tag]").forEach((el) => (el.textContent = CONFIG.testnet ? "Testnet" : "Mainnet"));
$$("[data-explorer]").forEach((a) => (a.href = CONFIG.chain.explorer));
const row = (k, v, href) => `<div><span>${esc(k)}</span>${href ? `<a href="${href}" target="_blank" rel="noopener">${esc(v)}</a>` : `<span>${esc(v)}</span>`}</div>`;
$("#dContracts").innerHTML = CONFIG.contracts.map((c) => row(c.name + (c.key.startsWith("vault") ? " · " + c.key.slice(5) : ""), c.proxy, explorerAddr(c.proxy))).join("");
$("#dNetwork").innerHTML = [
  row("Network", CONFIG.chain.name),
  row("Chain ID", String(CONFIG.chain.id)),
  row("RPC", CONFIG.chain.rpcs[0]),
  row("Explorer", CONFIG.chain.explorer, CONFIG.chain.explorer),
  CONFIG.chain.faucet && row("ETH faucet", CONFIG.chain.faucet, CONFIG.chain.faucet),
].filter(Boolean).join("");
addEventListener("load", smoothScroll);
