// A small shell, on the landing page and inside the terminal. Commands are async functions (args, print) => void;
// print takes HTML, so every value that comes from the chain must be escaped by the command before printing.
import { esc } from "./core.js";
import { sleep } from "./fx.js";

export const pad = (s, n) => String(s ?? "").slice(0, n).padEnd(n);
export const meter = (v, n = 16) => { const k = Math.round(Math.max(0, Math.min(1, v)) * n); return `<span class="acc">${"█".repeat(k)}</span>${"░".repeat(n - k)}`; };

export function mountConsole(root, { prompt, commands }) { // prompt: a string, or a function when it changes
  const out = root.querySelector(".term-out"), form = root.querySelector("form"), input = form.querySelector("input");
  const hist = [];
  let hi = 0, busy = false;

  const print = (html, cls = "") => {
    const ln = document.createElement("div");
    ln.className = "ln " + cls;
    ln.innerHTML = html;
    out.append(ln);
    out.scrollTop = out.scrollHeight;
    return ln;
  };

  async function run(line) {
    line = line.trim();
    print(`<span class="ps1">${typeof prompt === "function" ? prompt() : prompt}</span> ${esc(line)}`, "cmd");
    if (!line) return;
    hist.push(line);
    hi = hist.length;
    const [name, ...args] = line.split(/\s+/);
    const key = name.toLowerCase(), fn = Object.hasOwn(commands, key) && commands[key];
    if (!fn) return print(`command not found: ${esc(name)} · type <b>help</b>`, "err");
    busy = true;
    root.classList.add("busy");
    try { await fn(args, print); } catch (e) { print(`error: ${esc(e?.message || e)}`, "err"); }
    busy = false;
    root.classList.remove("busy");
  }

  // chips type their command out like a person would, then run it
  async function type(line) {
    if (busy) return;
    busy = true;
    input.value = "";
    for (const ch of line) { input.value += ch; await sleep(24); }
    await sleep(120);
    input.value = "";
    busy = false;
    await run(line);
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (busy) return;
    const v = input.value;
    input.value = "";
    run(v);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      hi = Math.max(0, Math.min(hist.length, hi + (e.key === "ArrowUp" ? -1 : 1)));
      input.value = hist[hi] ?? "";
    } else if (e.key === "Tab") {
      e.preventDefault();
      const m = Object.keys(commands).filter((c) => c.startsWith(input.value.trim().toLowerCase()));
      if (m.length === 1) input.value = m[0] + " ";
      else if (m.length) print(m.join("   "), "dim");
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      out.innerHTML = "";
    }
  });
  root.querySelectorAll("[data-cmd]").forEach((b) => b.addEventListener("click", () => type(b.dataset.cmd)));
  out.addEventListener("click", () => { if (!getSelection()?.toString()) input.focus({ preventScroll: true }); });

  return { run, type, print, clear: () => (out.innerHTML = "") };
}
