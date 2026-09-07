/* risky app: reads curves from the factory, quotes locally, trades through the Router with MetaMask. */

import { buildRiskyMark } from '../scripts/risky-mark.js';
import { TOKENS } from '../scripts/tokens.js';

/* ------------------------------------------------------------------ *
 * Chain + contracts (Robinhood Chain mainnet, deployed 2026-09-07, renounced)
 * ------------------------------------------------------------------ */
const NETS = {
  mainnet: {
    chain: { id: 4663, hex: '0x1237', name: 'Robinhood Chain', rpc: 'https://rpc.mainnet.chain.robinhood.com', rpcs: ['https://rpc.mainnet.chain.robinhood.com', 'https://robinhood-rpc.publicnode.com'], explorer: 'https://robinhoodchain.blockscout.com' },
    addr: { factory: '0xF9d9DdDc5cbD08021953C346C1E325F0CC03324a', router: '0x270cf29e1Ab9B112a5de379901Fcaf698761846f', admin: '0x8D63C5ADCA11Ca3FFF616B695915F8Ce45028B3b', weth: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73' },
  },
  /* The testnet stack from DEPLOY.md; reachable with ?net=testnet for trying the app without real funds. */
  testnet: {
    chain: { id: 46630, hex: '0xb626', name: 'Robinhood Chain Testnet', rpc: 'https://rpc.testnet.chain.robinhood.com/rpc', rpcs: ['https://rpc.testnet.chain.robinhood.com/rpc', 'https://robinhood-sepolia-rpc.publicnode.com'], explorer: 'https://explorer.testnet.chain.robinhood.com' },
    addr: { factory: '0xDb8CC7886278F59CA09776fF69f6cA8DE36A6d9b', router: '0xF232Fffa36b1941b17bDC092749Fd4024fa4F895', admin: '0xF328B83f1181254bf502024B5C16F6a09f90c509', weth: '0x33e4191705c386532ba27cBF171Db86919200B94' },
  },
};
const NET = new URLSearchParams(location.search).get('net') === 'testnet' ? 'testnet' : 'mainnet';
const CHAIN = NETS[NET].chain;
const ADDR = NETS[NET].addr;
const ZERO = '0x0000000000000000000000000000000000000000';
const DEAD = '0x000000000000000000000000000000000000dEaD';
/* Fee schedule is frozen on-chain (owner renounced): LP 0.25% + stakers 0.25% + protocol 0. */
const FEE = 0.005;
const CMD = { BUY: 0, SELL: 1, ADD: 2, REMOVE: 3, CLAIM: 4, STAKE: 5, UNSTAKE: 6 };

const SEL = {
  execute: '0x64429c58', createCurve: '0x56624b4a', getCurve: '0x61f029fb', allCurvesLength: '0x88876b2c', curves: '0x1bf7d749',
  curveParameters: '0x9a97fd9b', inverseTokenAddress: '0x66509bf0', reserveTokenAddress: '0xee1ea4ff',
  liquidityPositionOf: '0x861c52fd', stakingBalanceOf: '0x62e3efdd', rewardOf: '0x1d62ebd9', totalStaked: '0x817b1cd2',
  rewardEMAPerSecond: '0xc7be05e2', balanceOf: '0x70a08231', allowance: '0xdd62ed3e', approve: '0x095ea7b3',
  decimals: '0x313ce567', symbol: '0x95d89b41', name: '0x06fdde03', totalSupply: '0x18160ddd',
};
const ERRORS = {
  '0x7197da4b': 'Amount too small (minimum 0.0001)', '0xea73e556': 'Amount too large', '0x3808a408': 'Price moved outside your slippage limit',
  '0xe52c9169': 'Reserve moved outside your divergence limit', '0xf4d678b8': 'Insufficient balance', '0x7138356f': 'Empty address',
  '0xe06c7f74': 'Curve invariant check failed', '0x8fcef6a6': 'Utilization check failed', '0x3b2861c3': 'You already have an LP position on this curve; remove it first',
  '0x2339fcdf': 'You have no LP position on this curve', '0xa13dadba': 'A curve already exists for this asset', '0x76f33b41': 'Unsupported command',
  '0x26999f6f': 'This curve does not take ETH', '0x3d90e2a0': 'Deposit not allowed', '0x1e02524f': 'ETH sent does not match the amount', '0x82b42900': 'Unauthorized',
};

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */
const $ = (id) => document.getElementById(id);
const strip = (h) => h.replace(/^0x/, '');
const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const short = (a) => a ? a.slice(0, 6) + '…' + a.slice(-4) : '';
const MAX_UINT = (1n << 256n) - 1n;
const encAddr = (a) => strip(a).toLowerCase().padStart(64, '0');
const encUint = (n) => BigInt(n).toString(16).padStart(64, '0');
const decAddr = (r) => '0x' + strip(r).slice(-40);
const decWords = (r) => { const s = strip(r); const out = []; for (let i = 0; i + 64 <= s.length; i += 64) out.push(BigInt('0x' + s.slice(i, i + 64))); return out; };
function decString(r) {
  const w = decWords(r); if (w.length < 2) return '';
  const len = Number(w[1]); const hex = strip(r).slice(128, 128 + len * 2);
  return new TextDecoder().decode(new Uint8Array(hex.match(/../g).map((b) => parseInt(b, 16))));
}
/* bytes argument for execute(): head words, then offset → length → padded payload */
function encExecute(recipient, curve, useNative, command, payloadHex) {
  const p = strip(payloadHex); const padded = p + '0'.repeat((64 - (p.length % 64)) % 64);
  return SEL.execute + encAddr(recipient) + encAddr(curve) + encUint(useNative ? 1 : 0) + encUint(command) + encUint(160) + encUint(p.length / 2) + padded;
}
function toUnits(str, decimals) {
  const s = String(str).trim(); if (!s || !/^\d*\.?\d*$/.test(s)) return null;
  const [i = '0', f = ''] = s.split('.'); if (f.length > decimals) return BigInt(i + f.slice(0, decimals));
  return BigInt((i || '0') + f.padEnd(decimals, '0'));
}
const fromUnits = (bi, decimals) => Number(bi) / 10 ** decimals;
const scale18 = (bi, decimals) => decimals === 18 ? bi : decimals < 18 ? bi * 10n ** BigInt(18 - decimals) : bi / 10n ** BigInt(decimals - 18);
const fromNum = (n, decimals) => { if (!isFinite(n) || n <= 0) return 0n; return BigInt(Math.floor(n * 10 ** Math.min(decimals, 15))) * 10n ** BigInt(Math.max(0, decimals - 15)); };
function fmt(n, opts = {}) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e12) return n.toExponential(3);
  if (abs >= 1e5) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (abs >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: opts.dp ?? 4 });
  // Small values: plain decimals, never scientific notation.
  const sig = opts.sig ?? 4;
  const zeros = Math.max(0, -Math.floor(Math.log10(abs)) - 1);   // zeros right after the point
  const str = n.toFixed(Math.min(18, zeros + sig)).replace(/0+$/, '').replace(/\.$/, '');
  if (zeros >= 8 && opts.html !== false) {                      // 0.000000000025 -> 0.0₁₀25
    const [, digits] = str.split('.'); const rest = digits.slice(zeros);
    return `0.0<sub>${zeros}</sub>${rest}`;
  }
  return str;
}
const fmtPlain = (n, opts = {}) => fmt(n, { ...opts, html: false });

const pct = (x) => (x >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const link = (kind, x, text) => `<a href="${CHAIN.explorer}/${kind}/${x}" target="_blank" rel="noopener">${text || short(x)}</a>`;

/* ------------------------------------------------------------------ *
 * RPC (public node for reads; wallet only signs)
 * ------------------------------------------------------------------ */
let rpcId = 1;
/*
 * Reads go to the public node. Its load balancer occasionally answers with a
 * malformed CORS header that browsers reject, so the primary gets a second try
 * before the backup node is used. Log queries never go to the backup: it refuses
 * anything older than recent history.
 */
const ARCHIVE_ONLY = new Set(['eth_getLogs']);
async function rpc(method, params) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params });
  const primary = CHAIN.rpcs[0];
  const order = ARCHIVE_ONLY.has(method) ? [primary, primary, primary] : [primary, primary, ...CHAIN.rpcs.slice(1)];
  let lastErr = null;
  for (const url of order) {
    let res;
    try { res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body }); }
    catch (e) { lastErr = e; continue; }
    if (!res.ok && res.status >= 500) { lastErr = new Error('RPC ' + res.status); continue; }
    const j = await res.json();
    if (j.error) {
      // A node refusing on its own limits (archive access, block range) is not an answer; ask the next one.
      if (/archive|block range|personal token|too many|limit/i.test(j.error.message || '')) { lastErr = new Error(j.error.message); continue; }
      throw Object.assign(new Error(j.error.message), { data: j.error.data, code: j.error.code });
    }
    return j.result;
  }
  throw lastErr || new Error('Could not reach Robinhood Chain. Check your connection and try again.');
}
const call = (to, data) => rpc('eth_call', [{ to, data }, 'latest']);
const callAddr = async (to, data) => decAddr(await call(to, data));
const callUint = async (to, data) => decWords(await call(to, data))[0] ?? 0n;
const callStr = async (to, data) => decString(await call(to, data));
async function waitReceipt(hash) {
  for (let t = 0; t < 600; t++) {
    const r = await rpc('eth_getTransactionReceipt', [hash]).catch(() => null);
    if (r && r.blockNumber) return r;
    await new Promise((res) => setTimeout(res, 1200));
  }
  throw new Error('Timed out waiting for ' + hash);
}

/* ------------------------------------------------------------------ *
 * Wallet
 * ------------------------------------------------------------------ */
const wallet = { provider: null, account: null, chainOk: false };
window.addEventListener('eip6963:announceProvider', (e) => { const d = e.detail; if (d?.info && /metamask/i.test(d.info.rdns + d.info.name) && !wallet.provider) { wallet.provider = d.provider; wireProvider(); } });
window.dispatchEvent(new Event('eip6963:requestProvider'));
function injected() { const e = window.ethereum; if (!e) return null; return e.providers ? (e.providers.find((p) => p.isMetaMask) || e.providers[0]) : e; }
function provider() { return wallet.provider || injected(); }
async function wreq(method, params) { const p = provider(); if (!p) throw new Error('No wallet'); return p.request({ method, params }); }
let wired = false;
function wireProvider() {
  const p = provider(); if (!p || wired || !p.on) return; wired = true;
  p.on('accountsChanged', (a) => { wallet.account = a[0] || null; syncWallet(false); });
  p.on('chainChanged', () => syncWallet(false));
}
async function syncWallet(interactive) {
  const p = provider();
  if (!p) { wallet.account = null; renderWallet(interactive ? 'No wallet found in this browser. Open this page in Chrome with MetaMask installed.' : ''); return; }
  wireProvider();
  try {
    const accounts = await wreq(interactive ? 'eth_requestAccounts' : 'eth_accounts', []);
    wallet.account = accounts[0] || null;
  } catch (e) { wallet.account = null; renderWallet(e.code === 4001 ? 'Connection cancelled in MetaMask.' : e.code === -32002 ? 'MetaMask already has a request open — click the fox icon.' : e.message); return; }
  const chain = await wreq('eth_chainId', []).catch(() => null);
  wallet.chainOk = chain === CHAIN.hex;
  renderWallet('');
  if (wallet.account) refreshUser();
}
async function switchChain() {
  try { await wreq('wallet_switchEthereumChain', [{ chainId: CHAIN.hex }]); }
  catch (e) {
    if (e.code === 4902 || /unrecognized|not added/i.test(e.message || '')) {
      await wreq('wallet_addEthereumChain', [{ chainId: CHAIN.hex, chainName: CHAIN.name, rpcUrls: [CHAIN.rpc], nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, blockExplorerUrls: [CHAIN.explorer] }]);
    } else throw e;
  }
  await syncWallet(false);
}
function renderWallet(msg) {
  const w = $('wallet');
  if (!wallet.account) {
    w.innerHTML = `<button class="btn" id="connectBtn">Connect wallet</button>`;
  } else if (!wallet.chainOk) {
    w.innerHTML = `<span class="wallet__addr is-wrong">${short(wallet.account)}</span><button class="btn btn--red" id="switchBtn">Switch to Robinhood Chain</button>`;
  } else {
    w.innerHTML = `<span class="wallet__addr" title="${wallet.account}">${short(wallet.account)}</span>`;
  }
  $('connectBtn')?.addEventListener('click', () => syncWallet(true));
  $('switchBtn')?.addEventListener('click', () => switchChain().catch((e) => toast(e.message, 'bad')));
  if (msg) toast(msg, 'bad');
}
function requireWallet() {
  if (!wallet.account) throw new Error('Connect your wallet first');
  if (!wallet.chainOk) throw new Error('Switch MetaMask to Robinhood Chain');
}

/* ------------------------------------------------------------------ *
 * Transactions
 * ------------------------------------------------------------------ */
function decodeRevert(e) {
  const raw = e?.data?.data || e?.data || e?.error?.data || '';
  const hex = typeof raw === 'string' ? raw : (raw?.originalError?.data || '');
  const m = String(hex).match(/0x[0-9a-f]{8,}/i) || String(e?.message || '').match(/0x[0-9a-f]{8,}/i);
  if (m) {
    const sel = m[0].slice(0, 10).toLowerCase();
    if (sel === '0x08c379a0') { try { return decString('0x' + m[0].slice(10)); } catch {} }
    if (ERRORS[sel]) return ERRORS[sel];
  }
  if (e?.code === 4001) return 'Rejected in MetaMask';
  return (e?.message || String(e)).replace(/^.*execution reverted:?\s*/i, '').slice(0, 200);
}
async function sendTx(label, tx, log) {
  requireWallet();
  const base = { from: wallet.account, value: '0x0', ...tx };
  let gas;
  try { gas = BigInt(await rpc('eth_estimateGas', [base])); }
  catch (e) { throw new Error(`${label}: ${decodeRevert(e)}`); }
  base.gas = '0x' + (gas * 125n / 100n).toString(16);
  log(`${label}: confirm in MetaMask`);
  let hash;
  try { hash = await wreq('eth_sendTransaction', [base]); }
  catch (e) { throw new Error(`${label}: ${decodeRevert(e)}`); }
  log(`${label}: sent ${link('tx', hash)}`, 'link');
  const r = await waitReceipt(hash);
  if (r.status !== '0x1') throw new Error(`${label}: reverted on-chain (${short(hash)})`);
  log(`${label}: confirmed in block ${parseInt(r.blockNumber, 16)}`, 'ok');
  return r;
}
async function ensureAllowance(token, spender, amount, symbol, log) {
  const cur = await callUint(token, SEL.allowance + encAddr(wallet.account) + encAddr(spender));
  if (cur >= amount) return;
  await sendTx(`Approve ${symbol}`, { to: token, data: SEL.approve + encAddr(spender) + encUint(MAX_UINT) }, log);
}

/* ------------------------------------------------------------------ *
 * Curve data
 * ------------------------------------------------------------------ */
const state = { curves: [], loaded: false, user: {}, view: null, curve: null, tab: 'buy', histories: {}, spots: {} };

/* DexScreener knows the reserve coins: their artwork, spot price and 24h move. One fetch per token per visit. */
const dexCache = {};
function dexPairs(addr) {
  const key = (addr || '').toLowerCase(); if (!key || NET !== 'mainnet') return Promise.resolve([]);
  if (!dexCache[key]) {
    dexCache[key] = fetch(`https://api.dexscreener.com/token-pairs/v1/robinhood/${addr}`)
      .then((r) => (r.ok ? r.json() : [])).then((p) => (Array.isArray(p) ? p.filter((x) => same(x.baseToken?.address, addr)) : []))
      .catch(() => []);
  }
  return dexCache[key];
}
const iconCache = {};
async function iconFor(addr) {
  const key = (addr || '').toLowerCase(); if (!key) return null;
  if (key in iconCache) return iconCache[key];
  try { const v = localStorage.getItem('risky:icon:' + key); if (v) { iconCache[key] = v; return v; } } catch {}
  const hit = (await dexPairs(addr)).find((p) => p.info?.imageUrl);
  const url = hit ? hit.info.imageUrl : null;
  iconCache[key] = url;
  if (url) { try { localStorage.setItem('risky:icon:' + key, url); } catch {} }
  return url;
}
/* Spot price and 24h change of the reserve coin, from its deepest pool. */
async function spotFor(addr) {
  const key = (addr || '').toLowerCase();
  if (state.spots[key] !== undefined) return state.spots[key];
  const pairs = await dexPairs(addr);
  const best = pairs.slice().sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
  const spot = best && best.priceUsd ? { usd: Number(best.priceUsd), h24: best.priceChange?.h24 != null ? Number(best.priceChange.h24) / 100 : null, liq: best.liquidity?.usd || 0, url: best.url } : null;
  state.spots[key] = spot; return spot;
}
const usd = (n) => n === null || n === undefined || !isFinite(n) ? '' : n >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? '$' + (n / 1e3).toFixed(1) + 'k' : n >= 1 ? '$' + n.toFixed(2) : n > 0 ? '$' + fmtPlain(n, { sig: 3 }) : '$0';
/* Icon order: DexScreener → the site's own roster art → the ticker's first letters. */
function identity(symbol, isWeth, icon) {
  const sym = isWeth ? 'ETH' : symbol;
  const initials = esc((sym || '?').slice(0, 3));
  if (icon) return { label: sym, name: sym, html: `<span class="coin"><span class="coin__fb">${initials}</span><img src="${esc(icon)}" alt="" onerror="this.remove()"></span>`, color: '#ffffff' };
  const t = TOKENS.find((x) => x.ticker && x.ticker.toLowerCase() === (sym || '').toLowerCase());
  if (t) return { label: sym, name: t.name, html: `<span class="coin" style="--ring:${t.color}"><img src="../${t.image}" alt=""></span>`, color: t.color };
  if (isWeth) return { label: 'ETH', name: 'Ether', html: `<span class="coin coin--eth">Ξ</span>`, color: '#c9ced8' };
  return { label: sym || '?', name: sym || 'Token', html: `<span class="coin">${initials}</span>`, color: '#ffffff' };
}

async function loadCurve(addr) {
  const [reserveToken, ibToken, params] = await Promise.all([
    callAddr(addr, SEL.reserveTokenAddress), callAddr(addr, SEL.inverseTokenAddress), call(addr, SEL.curveParameters),
  ]);
  const [reserve, supply, lpSupply, price, invariant] = decWords(params);
  const isWeth = same(reserveToken, ADDR.weth);
  const [rSym, rDec, ibSym, totalStaked, emaLp, emaStake, reserveBal, icon] = await Promise.all([
    callStr(reserveToken, SEL.symbol), callUint(reserveToken, SEL.decimals), callStr(ibToken, SEL.symbol),
    callUint(addr, SEL.totalStaked), call(addr, SEL.rewardEMAPerSecond + encUint(0)), call(addr, SEL.rewardEMAPerSecond + encUint(1)),
    callUint(reserveToken, SEL.balanceOf + encAddr(addr)), iconFor(reserveToken),
  ]);
  const dec = Number(rDec);
  const c = {
    addr, reserveToken, ibToken, isWeth, dec, rSym, ibSym,
    reserve: fromUnits(reserve, 18), supply: fromUnits(supply, 18), lpSupply: fromUnits(lpSupply, 18), price: fromUnits(price, 18),
    invariant, totalStaked: fromUnits(totalStaked, 18), reserveBalance18: scale18(reserveBal, dec),
    emaLp: decWords(emaLp).map((x) => fromUnits(x, 18)), emaStake: decWords(emaStake).map((x) => fromUnits(x, 18)),
  };
  c.id = identity(rSym, isWeth, isWeth ? null : icon);
  const yr = 31536000;
  c.stakeApr = c.totalStaked > 0 ? ((c.emaStake[0] + c.emaStake[1] / c.price) * yr) / c.totalStaked : null;
  c.lpApr = c.reserve > 0 ? ((c.emaLp[0] + c.emaLp[1] / c.price) * yr) / (c.reserve / c.price) : null;
  return c;
}
async function loadCurves() {
  const n = Number(await callUint(ADDR.factory, SEL.allCurvesLength));
  const addrs = await Promise.all(Array.from({ length: n }, (_, i) => callAddr(ADDR.factory, SEL.curves + encUint(i))));
  state.curves = await Promise.all(addrs.map(loadCurve));
  state.loaded = true;
}
async function getHistory(c) {
  if (!state.histories[c.addr]) {
    state.histories[c.addr] = loadHistory(c).then((h) => { state.histories[c.addr] = h; return h; }).catch((e) => { delete state.histories[c.addr]; throw e; });
  }
  return state.histories[c.addr];
}
/* Plain-language summary of a market's history: how it has moved and how busy it is. */
function summarize(c, h) {
  if (!h || !h.length) return { sinceOpen: null, day: null, trades24: 0, opened: null };
  const dayAgo = Date.now() - 86400e3;
  const openPrice = h[0].price; const before = h.filter((e) => e.t < dayAgo); const base = before.length ? before[before.length - 1].price : h[0].t >= dayAgo ? h[0].price : openPrice;
  return {
    sinceOpen: openPrice > 0 ? c.price / openPrice - 1 : null,
    day: base > 0 ? c.price / base - 1 : null,
    trades24: h.filter((e) => e.t >= dayAgo && (e.kind === 'Mint' || e.kind === 'Burn')).length,
    opened: h[0].t,
  };
}
const move = (x) => x === null || x === undefined ? '<span class="faint">—</span>' : `<span class="${x > 0.00005 ? 'up' : x < -0.00005 ? 'down' : 'dim'}">${x > 0.00005 ? '▲ ' : x < -0.00005 ? '▼ ' : ''}${Math.abs(x * 100).toFixed(2)}%</span>`;
async function loadUser(c) {
  if (!wallet.account) return null;
  const me = wallet.account;
  const [resBal, ethBal, ibBal, staked, lp, rewards] = await Promise.all([
    callUint(c.reserveToken, SEL.balanceOf + encAddr(me)), c.isWeth ? rpc('eth_getBalance', [me, 'latest']).then(BigInt) : Promise.resolve(0n),
    callUint(c.ibToken, SEL.balanceOf + encAddr(me)), callUint(c.addr, SEL.stakingBalanceOf + encAddr(me)),
    call(c.addr, SEL.liquidityPositionOf + encAddr(me)), call(c.addr, SEL.rewardOf + encAddr(me)),
  ]);
  const [lpTokens, lpCredit] = decWords(lp); const [ibLp, ibStake, resLp, resStake] = decWords(rewards);
  return {
    reserve: c.isWeth ? fromUnits(ethBal, 18) : fromUnits(resBal, c.dec), reserveRaw: c.isWeth ? ethBal : resBal, weth: fromUnits(resBal, 18),
    ib: fromUnits(ibBal, 18), ibRaw: ibBal, staked: fromUnits(staked, 18), stakedRaw: staked,
    lp: fromUnits(lpTokens, 18), lpRaw: lpTokens, lpCredit: fromUnits(lpCredit, 18),
    rewardIb: fromUnits(ibLp + ibStake, 18), rewardRes: fromUnits(resLp + resStake, 18),
  };
}
async function refreshUser() { if (state.view === 'curve' && state.curve) { state.user[state.curve.addr] = await loadUser(state.curve); renderPosition(); updateQuote(); } if (state.view === 'explore') renderExplore(); if (state.view === 'create') loadCreateBalance(); }

/* ------------------------------------------------------------------ *
 * Curve math (mirrors InverseBondingCurve.sol, utilization 0.5)
 * price = R / (2S); invariant R = k·√S
 * ------------------------------------------------------------------ */
function quoteBuy(c, r) {
  if (!(r > 0)) return null;
  const newS = c.supply * ((c.reserve + r) / c.reserve) ** 2; const mint = newS - c.supply; const fee = mint * FEE; const out = mint - fee;
  const newPrice = 0.5 * (c.reserve + r) / newS;
  return { out, fee, newPrice, avgPrice: r / out, impact: newPrice / c.price - 1 };
}
/* Your position after a mint, then after one more trade of the same size either way. */
function whatNext(c, r, q) {
  const R1 = c.reserve + r, S1 = c.supply + q.out + q.fee; const p1 = 0.5 * R1 / S1;
  const worthNow = q.out * p1;
  const R2 = R1 + r, S2 = S1 * (R2 / R1) ** 2; const afterMint = q.out * (0.5 * R2 / S2);
  const burn = Math.min(S1 * 0.9, (r / p1) * (1 - FEE)); const S3 = S1 - burn, R3 = R1 * Math.sqrt(S3 / S1); const afterBurn = q.out * (0.5 * R3 / S3);
  return { worthNow, afterMint, afterBurn };
}
function quoteSell(c, s) {
  if (!(s > 0)) return null;
  const fee = s * FEE; const burn = s - fee; if (burn >= c.supply) return { out: NaN };
  const newR = c.reserve * Math.sqrt((c.supply - burn) / c.supply); const out = c.reserve - newR;
  const newPrice = 0.5 * newR / (c.supply - burn);
  return { out, fee, newPrice, avgPrice: out / s, impact: newPrice / c.price - 1 };
}
function quoteAddLp(c, r) {
  if (!(r > 0)) return null;
  const fee = r * FEE; const added = r - fee;
  return { fee, lp: added * c.lpSupply / c.reserve, credit: added * c.supply / c.reserve, share: added / (c.reserve + added) };
}
function quoteRemoveLp(c, u) {
  if (!u || !(u.lp > 0)) return null;
  const reserveRemoved = u.lp * c.reserve / c.lpSupply; const burned = u.lp * c.supply / c.lpSupply;
  const fee = reserveRemoved * FEE; const out = reserveRemoved - fee;
  const ibOut = u.lpCredit > burned ? (u.lpCredit - burned) * (1 - FEE) : 0; const ibNeeded = u.lpCredit < burned ? burned - u.lpCredit : 0;
  return { out, fee, ibOut, ibNeeded };
}
function geometry(seed) { if (!(seed > 0)) return null; const price = 2 / seed; const supply = seed * seed / 4; return { price, supply, lp: 1, credit: supply * 0.9999, dead: supply * 0.0001 }; }

/* ------------------------------------------------------------------ *
 * Routing + shell
 * ------------------------------------------------------------------ */
function setTop(title, sub) { $('title').textContent = title; $('subtitle').innerHTML = sub; }
function setNav(route) { document.querySelectorAll('.side__link').forEach((a) => a.classList.toggle('is-active', a.dataset.route === route)); }
function toast(msg, cls) { const el = document.querySelector('.log') || $('toast'); if (el) { el.insertAdjacentHTML('afterbegin', `<div class="log__row ${cls || ''}"><span>${esc(msg)}</span></div>`); } else console.warn(msg); }

async function route() {
  const h = location.hash || '#/';
  const m = h.match(/^#\/curve\/(0x[0-9a-fA-F]{40})/);
  if (m) return showCurve(m[1]);
  if (h.startsWith('#/create')) return showCreate();
  if (h.startsWith('#/how')) { location.replace('../docs/'); return; }
  return showExplore();
}
window.addEventListener('hashchange', route);

/* ---------- Explore ---------- */
async function showExplore() {
  state.view = 'explore'; setNav('explore');
  setTop('Explore', 'Every market open on Robinhood Chain');
  $('view').innerHTML = `<div class="card"><div class="empty dim">Reading the factory…</div></div>`;
  try { await loadCurves(); } catch (e) { $('view').innerHTML = `<div class="card"><div class="note note--bad">Could not reach the chain: ${esc(e.message)}</div></div>`; return; }
  renderExplore();
  // Moves and trade counts need each market's history; fill them in as they arrive.
  Promise.all(state.curves.slice(0, 24).map((c) => getHistory(c).catch((e) => { console.warn('history failed for', c.ibSym, e.message); return null; }))).then(() => renderExplore());
  Promise.all(state.curves.slice(0, 24).map((c) => spotFor(c.reserveToken))).then(() => renderExplore());
}
function renderExplore() {
  if (state.view !== 'explore') return;
  const rows = state.curves.map((c) => {
    const h = state.histories[c.addr]; const sum = summarize(c, Array.isArray(h) ? h : null);
    const sp = state.spots[c.reserveToken.toLowerCase()];
    return `
    <tr class="is-link" data-go="#/curve/${c.addr}">
      <td><div class="asset">${c.id.html}<div><div class="asset__name">${esc(c.ibSym)}</div><span class="asset__sub">pay ${esc(c.id.label)}, get ${esc(c.ibSym)}</span></div></div></td>
      <td>${sp === undefined ? '<span class="faint">…</span>' : sp ? `${usd(sp.usd)}<br>${move(sp.h24)}` : '<span class="faint">—</span>'}</td>
      <td>${fmt(c.reserve)} <span class="dim">${esc(c.id.label)}</span>${sp && sp.usd ? `<br><span class="dim">${usd(c.reserve * sp.usd)}</span>` : ''}</td>
      <td>${Array.isArray(h) ? move(sum.day) : '<span class="faint">…</span>'}</td>
      <td>${Array.isArray(h) ? move(sum.sinceOpen) : '<span class="faint">…</span>'}</td>
      <td>${Array.isArray(h) ? (sum.trades24 || '<span class="faint">0</span>') : '<span class="faint">…</span>'}</td>
      <td>${c.stakeApr === null ? '<span class="faint">be first</span>' : !c.stakeApr ? '—' : pct(c.stakeApr).replace('+', '') + ' <span class="dim">/yr</span>'}</td>
    </tr>`; }).join('');
  $('view').innerHTML = `
    <div class="intro">
      <div class="intro__item"><b><span class="n">01</span>Pick a market</b>Each market runs on one coin. You pay that coin and get the ib-version back.</div>
      <div class="intro__item"><b><span class="n">02</span>Bet on the crowd</b>Your ibAsset gains value when other people burn and loses when they mint. That is the whole game.</div>
      <div class="intro__item"><b><span class="n">03</span>Earn from trades</b>Every trade pays 0.5%, split between stakers and liquidity providers. risky keeps nothing.</div>
    </div>
    <div class="card">
      <div class="card__head"><span class="card__title">Markets</span><span class="dim">${state.curves.length} open · no admin key</span></div>
      ${state.curves.length ? `<div style="overflow-x:auto"><table class="table"><thead><tr><th>Market</th><th>Coin spot · 24h</th><th>Value locked</th><th>ibAsset 24h</th><th>Since open</th><th>Trades 24h</th><th>Stakers earn</th></tr></thead><tbody>${rows}</tbody></table></div>`
        : `<div class="empty">No markets yet. The first person to open one for a coin owns that first move forever.<br><a class="btn" href="#/create">Open the first market</a></div>`}
    </div>
    <p class="dim" style="margin:14px 4px 0;font-size:13px">New here? <a href="../docs/" class="up">The docs</a> cover the curve, fees, liquidity and what can go wrong in about five minutes.</p>`;
  document.querySelectorAll('[data-go]').forEach((tr) => tr.addEventListener('click', () => { location.hash = tr.dataset.go; }));
}

/* ---------- Curve page ---------- */
const EV = {
  init: '0xec44ea52a857a3b3830feee449ccbf085eef95ad145d879e06365430ab5a3efb',
  buy: '0x9fa236593f411affe147142a606176190ea6b18be0643332f081175cfe608b6b',
  sell: '0xa8a7473f10e62cf9687e243de1c3ac8b3cbc3dd04b96826beb3a65b595385814',
  lpAdd: '0x4a1a2a6176e9646d9e3157f7c2ab3c499f18337c0b0828cfb28e0a61de4a11f7',
  lpRemove: '0x54b49308110acbc943590c21d865ac0b5af21362356e8282b82e242c35c5a06b',
};
/* Price after every event, rebuilt from the curve's reserve and invariant: price = i² / (2R). */
async function loadHistory(c) {
  let logs = await rpc('eth_getLogs', [{ address: c.addr, fromBlock: '0x0', toBlock: 'latest' }]);
  if (logs.length > 800) logs = [logs[0], ...logs.slice(-799)];
  const events = []; let R = 0, inv = 0;
  for (const l of logs) {
    const w = decWords(l.data).map((x) => fromUnits(x, 18)); const t = l.topics[0]; let kind, size, unit;
    if (t === EV.init) { R = w[0]; inv = w[3]; kind = 'Market opened'; size = w[0]; unit = c.id.label; }
    else if (t === EV.buy) { R += w[0]; kind = 'Mint'; size = w[0]; unit = c.id.label; }
    else if (t === EV.sell) { R -= w[1]; kind = 'Burn'; size = w[0]; unit = c.ibSym; }
    else if (t === EV.lpAdd) { R += w[0] * (1 - FEE); inv = w[2]; kind = 'Liquidity added'; size = w[0]; unit = c.id.label; }
    else if (t === EV.lpRemove) { R -= w[1] / (1 - FEE); inv = w[4]; kind = 'Liquidity removed'; size = w[1]; unit = c.id.label; }
    else continue;
    events.push({ block: parseInt(l.blockNumber, 16), tx: l.transactionHash, kind, size, unit, price: R > 0 ? inv * inv / (2 * R) : 0 });
  }
  const blocks = [...new Set(events.map((e) => e.block))]; const times = {};
  for (let i = 0; i < blocks.length; i += 12) {
    await Promise.all(blocks.slice(i, i + 12).map(async (bn) => { const blk = await rpc('eth_getBlockByNumber', ['0x' + bn.toString(16), false]); times[bn] = parseInt(blk.timestamp, 16) * 1000; }));
  }
  events.forEach((e) => { e.t = times[e.block]; });
  return events;
}

async function showCurve(addr) {
  state.view = 'curve'; setNav('explore');
  $('view').innerHTML = `<div class="card"><div class="empty dim">Loading market…</div></div>`;
  let c;
  try { c = await loadCurve(addr); } catch (e) { $('view').innerHTML = `<div class="card"><div class="note note--bad">Not a market: ${esc(e.message)}</div></div>`; return; }
  state.curve = c; state.chart = { mode: 'curve', range: 'all', history: null, preview: null };
  const i = state.curves.findIndex((x) => same(x.addr, addr)); if (i >= 0) state.curves[i] = c; else state.curves.push(c);
  setTop(c.ibSym, `Minted against ${esc(c.id.label)} · ${link('address', c.addr, 'market contract')} · ${link('address', c.ibToken, 'token contract')}`);
  $('view').innerHTML = `
    <div class="grid">
      <div>
        <div class="card">
          <div class="card__head"><div class="asset">${c.id.html.replace('class="coin', 'class="coin coin--lg')}<div><div class="card__title">${esc(c.ibSym)}</div><span class="asset__sub">pay ${esc(c.id.label)}, get ${esc(c.ibSym)}</span></div></div><span class="dim mono" style="font-size:12px">${short(c.addr)}</span></div>
          <div class="priceline" id="priceLine"></div>
          <div class="stats" id="stats"></div>
          <div class="chartbox">
            <div class="chartbox__bar">
              <div class="seg" id="chartMode"><button data-mode="curve" class="is-active">The curve</button><button data-mode="history">Price history</button></div>
              <div class="seg" id="chartRange"><button data-range="1h">1H</button><button data-range="1d">1D</button><button data-range="1w">1W</button><button data-range="all" class="is-active">All</button></div>
            </div>
            <div class="chart"><svg id="chart" viewBox="0 0 600 260" preserveAspectRatio="none"></svg><div class="tip hidden" id="tip"></div><div class="chart__empty hidden" id="chartEmpty"></div><div class="chart__foot" id="chartFoot"></div></div>
          </div>
        </div>
        <div class="card"><div class="card__head"><span class="card__title">Your position</span></div><div id="position" class="dim">Connect your wallet to see your balances.</div></div>
      </div>
      <div class="card" id="panel"></div>
    </div>`;
  document.querySelectorAll('#chartMode button').forEach((b) => b.addEventListener('click', () => { state.chart.mode = b.dataset.mode; document.querySelectorAll('#chartMode button').forEach((x) => x.classList.toggle('is-active', x === b)); drawChart(state.chart.preview); }));
  document.querySelectorAll('#chartRange button').forEach((b) => b.addEventListener('click', () => { state.chart.range = b.dataset.range; document.querySelectorAll('#chartRange button').forEach((x) => x.classList.toggle('is-active', x === b)); drawChart(state.chart.preview); }));
  const svg = $('chart');
  svg.addEventListener('mousemove', (e) => chartHover(e)); svg.addEventListener('mouseleave', () => chartHover(null)); svg.addEventListener('click', (e) => chartClick(e));
  renderStats(); drawChart(null); renderPanel();
  spotFor(c.reserveToken).then(() => { if (state.curve === c) renderStats(); });
  getHistory(c).then((h) => { if (state.curve === c) { state.chart.history = h; renderStats(); drawChart(state.chart.preview); } }).catch(() => { if (state.curve === c) { state.chart.history = []; renderStats(); drawChart(state.chart.preview); } });
  if (wallet.account) { state.user[c.addr] = await loadUser(c); renderPosition(); updateQuote(); }
}
function renderStats() {
  const c = state.curve; const h = state.chart?.history; const sum = summarize(c, Array.isArray(h) ? h : null);
  const R = esc(c.id.label), IB = esc(c.ibSym);
  const odd = c.price > 100 || c.price < 0.01;
  const sp = state.spots[c.reserveToken.toLowerCase()];
  $('priceLine').innerHTML = `
    <div class="priceline__main"><b>1 ${R}</b> buys <b>${fmt(1 / c.price)} ${IB}</b><span class="dim"> · 1 ${IB} = ${fmt(c.price)} ${R}</span></div>
    ${sp ? `<div class="priceline__spot">${R} spot <b>${usd(sp.usd)}</b> ${move(sp.h24)} <span class="dim">24h</span>${sp.url ? ` · <a class="dim" href="${esc(sp.url)}" target="_blank" rel="noopener">DexScreener ↗</a>` : ''}</div>` : ''}
    ${odd ? `<details class="why"><summary>Why does the price look strange?</summary><p>This market was opened with a very ${c.price > 100 ? 'small' : 'large'} seed, so one whole ${IB} is a ${c.price > 100 ? 'huge' : 'tiny'} slice of it. The unit price is just a label. What matters is direction: it goes <span class="down">down</span> when people mint and <span class="up">up</span> when they burn, and your position moves with it.</p></details>` : ''}`;
  $('stats').innerHTML = `
    <div class="stat"><div class="stat__label">Value locked</div><div class="stat__value">${fmt(c.reserve)}<small>${R}</small></div><div class="stat__sub">${sp && sp.usd ? usd(c.reserve * sp.usd) + ' · ' : ''}backing every ${IB}</div></div>
    <div class="stat"><div class="stat__label">Last 24h</div><div class="stat__value">${Array.isArray(h) ? move(sum.day) : '<span class="faint">…</span>'}</div><div class="stat__sub">${sum.trades24} trade${sum.trades24 === 1 ? '' : 's'}</div></div>
    <div class="stat"><div class="stat__label">Since open</div><div class="stat__value">${Array.isArray(h) ? move(sum.sinceOpen) : '<span class="faint">…</span>'}</div><div class="stat__sub">${sum.opened ? 'opened ' + new Date(sum.opened).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''}</div></div>
    <div class="stat"><div class="stat__label">Staked</div><div class="stat__value">${fmt(c.totalStaked)}<small>${IB}</small></div><div class="stat__sub">${c.stakeApr === null ? 'nobody yet — first staker takes all fees so far' : 'earning about ' + (c.stakeApr * 100).toFixed(1) + '% a year'}</div></div>`;
}

/* ---- charts ---- */
const CW = 600, CH = 260, PAD = { l: 14, r: 14, t: 18, b: 14 };
const fmtTime = (t) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
let chartGeom = null;   // what the last draw put on screen, for hover math

function drawChart(preview) {
  if (!state.curve || state.view !== 'curve' || !$('chart')) return;
  state.chart.preview = preview;
  $('chartRange').classList.toggle('hidden', state.chart.mode !== 'history');
  $('tip').classList.add('hidden');
  if (state.chart.mode === 'curve') drawCurveChart(preview); else drawHistoryChart();
}
function curveFn(c) { const k = c.reserve / Math.sqrt(c.supply); return (s) => 0.5 * k / Math.sqrt(s); }
function drawCurveChart(preview) {
  const c = state.curve; const svg = $('chart'); const P = curveFn(c);
  const s0 = c.supply * 0.25, s1 = c.supply * 3; const pMax = P(s0), pMin = P(s1);
  const X = (s) => PAD.l + (s - s0) / (s1 - s0) * (CW - PAD.l - PAD.r);
  const Y = (p) => PAD.t + (1 - (p - pMin) / (pMax - pMin)) * (CH - PAD.t - PAD.b);
  chartGeom = { kind: 'curve', s0, s1, X, Y, P };
  let d = ''; for (let i = 0; i <= 120; i++) { const s = s0 + (s1 - s0) * i / 120; d += (i ? 'L' : 'M') + X(s).toFixed(1) + ' ' + Y(P(s)).toFixed(1); }
  const area = d + `L${X(s1).toFixed(1)} ${CH - PAD.b}L${X(s0).toFixed(1)} ${CH - PAD.b}Z`;
  const cx = X(c.supply), cy = Y(c.price);
  let prev = '';
  if (preview && preview.supply > 0) {
    const ps = Math.min(Math.max(preview.supply, s0), s1); const px = X(ps), py = Y(P(ps)); const col = preview.supply > c.supply ? '#ff3d3d' : '#00d95a';
    prev = `<line x1="${cx}" y1="${cy}" x2="${px}" y2="${py}" stroke="${col}" stroke-width="1.5" stroke-dasharray="4 4"/><circle cx="${px}" cy="${py}" r="5" fill="${col}"/>`;
  }
  svg.innerHTML = `<defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".10"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
    ${[0.25, 0.5, 0.75].map((f) => `<line x1="${PAD.l}" x2="${CW - PAD.r}" y1="${(PAD.t + (CH - PAD.t - PAD.b) * f).toFixed(1)}" y2="${(PAD.t + (CH - PAD.t - PAD.b) * f).toFixed(1)}" stroke="rgba(255,255,255,0.05)"/>`).join('')}
    <path d="${area}" fill="url(#cg)"/><path d="${d}" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <line x1="${cx}" x2="${cx}" y1="${cy}" y2="${CH - PAD.b}" stroke="rgba(255,255,255,0.22)" stroke-dasharray="3 5"/>
    <circle cx="${cx}" cy="${cy}" r="5" fill="#fff"/><circle cx="${cx}" cy="${cy}" r="10" fill="none" stroke="rgba(255,255,255,0.35)"/>${prev}
    <g id="hoverLayer"></g>`;
  $('chartEmpty').classList.add('hidden');
  $('chartFoot').innerHTML = `<span>price vs. minted supply</span><span>now <b>${fmt(c.price)} ${esc(c.id.label)}</b> at <b>${fmt(c.supply)}</b> minted</span><span>hover to explore · click to set an amount</span>`;
}
function rangeMs(r) { return r === '1h' ? 3600e3 : r === '1d' ? 86400e3 : r === '1w' ? 7 * 86400e3 : Infinity; }
function drawHistoryChart() {
  const c = state.curve; const svg = $('chart'); const h = state.chart.history;
  const empty = $('chartEmpty'); const foot = $('chartFoot');
  svg.innerHTML = ''; chartGeom = null;
  if (h === null) { empty.textContent = 'Loading trade history…'; empty.classList.remove('hidden'); foot.innerHTML = ''; return; }
  const now = Date.now(); const span = rangeMs(state.chart.range); const start = span === Infinity ? (h[0]?.t ?? now) : now - span;
  const inRange = h.filter((e) => e.t >= start); const before = h.filter((e) => e.t < start);
  const pts = [];
  if (before.length) pts.push({ t: start, price: before[before.length - 1].price, carry: true });
  pts.push(...inRange);
  const last = h[h.length - 1];
  if (last) pts.push({ t: now, price: c.price, now: true });
  if (pts.length < 2) { empty.textContent = 'No trades yet'; empty.classList.remove('hidden'); foot.innerHTML = ''; return; }
  empty.classList.add('hidden');
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t || now;
  let pMin = Math.min(...pts.map((p) => p.price)), pMax = Math.max(...pts.map((p) => p.price));
  if (pMax === pMin) { pMax *= 1.05; pMin *= 0.95; } else { const padP = (pMax - pMin) * 0.12; pMax += padP; pMin = Math.max(0, pMin - padP); }
  const X = (t) => PAD.l + (t - t0) / Math.max(1, t1 - t0) * (CW - PAD.l - PAD.r);
  const Y = (p) => PAD.t + (1 - (p - pMin) / (pMax - pMin)) * (CH - PAD.t - PAD.b);
  chartGeom = { kind: 'history', pts, X, Y };
  const d = pts.map((p, i) => (i ? 'L' : 'M') + X(p.t).toFixed(1) + ' ' + Y(p.price).toFixed(1)).join('');
  const area = d + `L${X(t1).toFixed(1)} ${CH - PAD.b}L${X(t0).toFixed(1)} ${CH - PAD.b}Z`;
  const first = pts[0].price, up = c.price >= first; const col = up ? '#00d95a' : '#ff3d3d';
  const dots = inRange.map((e) => `<circle cx="${X(e.t).toFixed(1)}" cy="${Y(e.price).toFixed(1)}" r="2.5" fill="${col}"/>`).join('');
  svg.innerHTML = `<defs><linearGradient id="hg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".22"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    ${[0.25, 0.5, 0.75].map((f) => `<line x1="${PAD.l}" x2="${CW - PAD.r}" y1="${(PAD.t + (CH - PAD.t - PAD.b) * f).toFixed(1)}" y2="${(PAD.t + (CH - PAD.t - PAD.b) * f).toFixed(1)}" stroke="rgba(255,255,255,0.05)"/>`).join('')}
    <path d="${area}" fill="url(#hg)"/><path d="${d}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>${dots}
    <circle cx="${X(t1).toFixed(1)}" cy="${Y(c.price).toFixed(1)}" r="4" fill="${col}"/><circle cx="${X(t1).toFixed(1)}" cy="${Y(c.price).toFixed(1)}" r="9" fill="none" stroke="${col}" stroke-opacity=".45"/>
    <text x="${PAD.l}" y="${PAD.t - 6}" fill="rgba(255,255,255,.35)" font-size="10" font-family="ui-monospace,Menlo,monospace">${fmtPlain(pMax)}</text>
    <text x="${PAD.l}" y="${CH - PAD.b - 4}" fill="rgba(255,255,255,.35)" font-size="10" font-family="ui-monospace,Menlo,monospace">${fmtPlain(pMin)}</text>
    <g id="hoverLayer"></g>`;
  const trades = h.filter((e) => e.kind === 'Mint' || e.kind === 'Burn').length;
  const change = first > 0 ? (c.price / first - 1) : 0;
  foot.innerHTML = `<span>${state.chart.range === 'all' ? 'since ' + fmtTime(h[0].t) : 'last ' + state.chart.range.toUpperCase()}</span><span class="${up ? 'up' : 'down'}"><b class="${up ? 'up' : 'down'}">${pct(change)}</b></span><span>${trades} trade${trades === 1 ? '' : 's'} · ${h.length - 1 - trades} liquidity move${h.length - 1 - trades === 1 ? '' : 's'}</span>`;
}
function svgPoint(e) { const svg = $('chart'); const r = svg.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * CW, y: (e.clientY - r.top) / r.height * CH }; }
function chartHover(e) {
  const layer = $('hoverLayer'); const tip = $('tip'); if (!layer || !chartGeom) return;
  if (!e) { layer.innerHTML = ''; tip.classList.add('hidden'); return; }
  const c = state.curve; const { x } = svgPoint(e);
  if (chartGeom.kind === 'curve') {
    const { s0, s1, X, Y, P } = chartGeom; const s = Math.min(s1, Math.max(s0, s0 + (x - PAD.l) / (CW - PAD.l - PAD.r) * (s1 - s0)));
    const p = P(s); const px = X(s), py = Y(p);
    layer.innerHTML = `<line x1="${px}" x2="${px}" y1="${PAD.t}" y2="${CH - PAD.b}" stroke="rgba(255,255,255,0.18)"/><circle cx="${px}" cy="${py}" r="4" fill="#fff"/>`;
    let how;
    if (s > c.supply * 1.001) how = `<span class="dim">mint ${fmtPlain(c.reserve * (Math.sqrt(s / c.supply) - 1))} ${esc(c.id.label)} to get here</span>`;
    else if (s < c.supply * 0.999) how = `<span class="dim">burn ${fmtPlain((c.supply - s) / (1 - FEE))} ${esc(c.ibSym)} to get here</span>`;
    else how = `<span class="dim">current market</span>`;
    tip.innerHTML = `${fmt(p)} ${esc(c.id.label)} <span class="dim">at ${fmt(s)} ${esc(c.ibSym)} minted</span>${how}`;
    tip.style.left = (px / CW * 100 > 60 ? 'auto' : '12px'); tip.style.right = (px / CW * 100 > 60 ? '12px' : 'auto');
    tip.classList.remove('hidden');
  } else {
    const { pts, X, Y } = chartGeom; let best = null, bd = Infinity;
    for (const p of pts) { if (p.carry) continue; const dx = Math.abs(X(p.t) - x); if (dx < bd) { bd = dx; best = p; } }
    if (!best) return;
    const px = X(best.t), py = Y(best.price);
    layer.innerHTML = `<line x1="${px}" x2="${px}" y1="${PAD.t}" y2="${CH - PAD.b}" stroke="rgba(255,255,255,0.18)"/><circle cx="${px}" cy="${py}" r="4.5" fill="#fff"/>`;
    tip.innerHTML = `${fmt(best.price)} ${esc(c.id.label)}<span class="dim">${best.now ? 'now' : fmtTime(best.t)}</span>${best.kind ? `<span class="dim">${best.kind}${best.size ? ' · ' + fmtPlain(best.size) + ' ' + esc(best.unit) : ''}</span>` : ''}`;
    tip.style.left = (px / CW * 100 > 60 ? 'auto' : '12px'); tip.style.right = (px / CW * 100 > 60 ? '12px' : 'auto');
    tip.classList.remove('hidden');
  }
}
function chartClick(e) {
  if (!chartGeom) return; const c = state.curve;
  if (chartGeom.kind === 'history') { const { pts, X } = chartGeom; const { x } = svgPoint(e); let best = null, bd = Infinity; for (const p of pts) { if (p.tx && Math.abs(X(p.t) - x) < bd) { bd = Math.abs(X(p.t) - x); best = p; } } if (best && bd < 12) window.open(`${CHAIN.explorer}/tx/${best.tx}`, '_blank', 'noopener'); return; }
  const { s0, s1, P } = chartGeom; const { x } = svgPoint(e); const s = Math.min(s1, Math.max(s0, s0 + (x - PAD.l) / (CW - PAD.l - PAD.r) * (s1 - s0)));
  if (s > c.supply * 1.001) { state.tab = 'buy'; renderPanel(); $('amt').value = fmtPlain(c.reserve * (Math.sqrt(s / c.supply) - 1), { sig: 6 }); }
  else if (s < c.supply * 0.999) { state.tab = 'sell'; renderPanel(); $('amt').value = fmtPlain((c.supply - s) / (1 - FEE), { sig: 6 }); }
  else return;
  updateQuote();
}
function renderPosition() {
  const c = state.curve; const u = state.user[c.addr]; const el = $('position'); if (!el) return;
  if (!u) { el.innerHTML = 'Connect your wallet to see your balances.'; return; }
  el.innerHTML = `<dl class="pos">
    <dt>${esc(c.id.label)} you can spend</dt><dd>${fmt(u.reserve)}</dd>
    <dt>${esc(c.ibSym)} you hold</dt><dd>${fmt(u.ib)} <span class="dim">worth ${fmt(u.ib * c.price)} ${esc(c.id.label)} now</span></dd>
    <dt>${esc(c.ibSym)} staked</dt><dd>${fmt(u.staked)}</dd>
    <dt>Liquidity position</dt><dd>${u.lp > 0 ? `${fmt(u.lp)} LP <span class="dim">· ${fmt(u.lpCredit)} ${esc(c.ibSym)} credited</span>` : '<span class="dim">none</span>'}</dd>
    <dt>Fees waiting to claim</dt><dd>${fmt(u.rewardIb)} ${esc(c.ibSym)} + ${fmt(u.rewardRes)} ${esc(c.id.label)}</dd>
  </dl>`;
}

const TABS = [['buy', 'Mint', 'tab--buy'], ['sell', 'Burn', 'tab--sell'], ['add', 'Add LP', ''], ['remove', 'Remove LP', ''], ['stake', 'Stake', ''], ['unstake', 'Unstake', ''], ['claim', 'Claim', '']];
const LEADS = {
  buy: (R, IB) => `Put in <b>${R}</b>, get <b>${IB}</b>. From then on your ${IB} gains when others burn and loses when others mint.`,
  sell: (R, IB) => `Hand back <b>${IB}</b>, get <b>${R}</b> out. Burning nudges the price <b class="up">up</b> for everyone still holding.`,
  add: (R, IB) => `Add <b>${R}</b> to deepen this market and earn a share of every trade. One position per wallet; it closes in full.`,
  remove: (R, IB) => `Close your liquidity position and take your <b>${R}</b> back. Depending on where the price went, you receive or return some <b>${IB}</b>.`,
  stake: (R, IB) => `Lock <b>${IB}</b> here to collect 0.25% of every trade on this market. Unstake any time.`,
  unstake: (R, IB) => `Take staked <b>${IB}</b> back to your wallet. Fees you earned stay claimable.`,
  claim: (R, IB) => `Collect the fees your stake and liquidity have earned. Paid in <b>${IB}</b> and <b>${R}</b>.`,
};
function renderPanel() {
  const c = state.curve; const t = state.tab; const R = esc(c.id.label), IB = esc(c.ibSym);
  const unit = (lab, coin) => `<span class="field__unit">${coin}${lab}</span>`;
  const rc = c.id.html.replace('class="coin', 'class="coin'); const ic = `<span class="coin" style="background:#0f1a14;color:#7dffb4">ib</span>`;
  const payField = (label, lab, coin, balKey, ro) => `
    <div class="field"><div class="field__row"><span>${label}</span><span>Balance: <b id="bal-${balKey}">—</b> ${balKey !== 'none' ? `<button id="max-${balKey}">MAX</button>` : ''}</span></div>
    <div class="field__main"><input class="field__input" id="amt" inputmode="decimal" placeholder="0" ${ro ? 'readonly' : ''}>${unit(lab, coin)}</div></div>`;
  const outField = (label, lab, coin) => `<div class="swap-arrow">↓</div><div class="field"><div class="field__row"><span>${label}</span></div><div class="field__main"><input class="field__input" id="out" readonly placeholder="0">${unit(lab, coin)}</div></div>`;
  let body = '', btn = '';
  if (t === 'buy') { body = payField('You pay', R, rc, 'reserve') + outField('You receive', IB, ic); btn = `<button class="btn btn--green btn--wide" id="go">Mint ${IB}</button>`; }
  if (t === 'sell') { body = payField('You burn', IB, ic, 'ib') + outField('You receive', R, rc); btn = `<button class="btn btn--red btn--wide" id="go">Burn ${IB}</button>`; }
  if (t === 'add') { body = payField('You add', R, rc, 'reserve') + outField('LP tokens', 'LP', '<span class="coin">LP</span>'); btn = `<button class="btn btn--wide" id="go">Add liquidity</button>`; }
  if (t === 'remove') { body = `<div class="field"><div class="field__row"><span>Your LP position</span></div><div class="field__main"><input class="field__input" id="amt" readonly placeholder="0">${unit('LP', '<span class="coin">LP</span>')}</div></div>` + outField('You receive', R, rc); btn = `<button class="btn btn--wide" id="go">Remove all liquidity</button>`; }
  if (t === 'stake') { body = payField('You stake', IB, ic, 'ib'); btn = `<button class="btn btn--wide" id="go">Stake ${IB}</button>`; }
  if (t === 'unstake') { body = payField('You unstake', IB, ic, 'staked'); btn = `<button class="btn btn--wide" id="go">Unstake ${IB}</button>`; }
  if (t === 'claim') { body = `<div class="field"><div class="field__row"><span>Claimable</span></div><div class="stat__value" id="claimable">—</div></div>`; btn = `<button class="btn btn--wide" id="go">Claim fees</button>`; }
  const limits = ['buy', 'sell'].includes(t) ? `<details class="adv"><summary>Advanced: slippage and reserve guard</summary><div class="meta"><div class="meta__row"><span>Worst price you accept</span><span><input id="slip" value="1">% off quote</span></div><div class="meta__row"><span>Cancel if reserve moved more than</span><span><input id="div" value="5">%</span></div></div></details>` : ['add', 'remove'].includes(t) ? `<details class="adv"><summary>Advanced: price guard</summary><div class="meta"><div class="meta__row"><span>Cancel if price moved more than</span><span><input id="slip" value="1">%</span></div></div></details>` : '';
  $('panel').innerHTML = `
    <div class="tabs">${TABS.map(([k, lab, cls]) => `<button class="tab ${cls} ${k === t ? 'is-active' : ''}" data-tab="${k}">${lab}</button>`).join('')}</div>
    <p class="lead">${LEADS[t](R, IB)}</p>
    ${body}
    <div class="meta" id="meta"></div>
    ${limits}
    <div class="go-wrap">${btn}</div>
    <div id="hint"></div>
    <div class="log" id="log"></div>`;
  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { state.tab = b.dataset.tab; renderPanel(); updateQuote(); }));
  $('amt')?.addEventListener('input', updateQuote);
  $('slip')?.addEventListener('input', updateQuote); $('div')?.addEventListener('input', updateQuote);
  ['reserve', 'ib', 'staked'].forEach((k) => $('max-' + k)?.addEventListener('click', () => { const u = state.user[c.addr]; if (!u) return; let v = k === 'reserve' ? u.reserve : k === 'ib' ? u.ib : u.staked; if (k === 'reserve' && c.isWeth) v = Math.max(0, v - 0.0005); $('amt').value = String(v); updateQuote(); }));
  $('go').addEventListener('click', () => act().catch((e) => log(e.message, 'bad')));
  updateQuote();
}
function log(msg, cls) { const el = $('log'); if (!el) return; el.insertAdjacentHTML('afterbegin', `<div class="log__row ${cls === 'link' ? '' : (cls || '')}">${cls === 'link' ? msg : esc(msg)}</div>`); }
function limitsFromInputs() { const slip = Math.max(0, parseFloat($('slip')?.value || '1')) / 100; const div = Math.max(0, parseFloat($('div')?.value || '5')) / 100; return { slip, div }; }
function updateQuote() {
  const c = state.curve; if (!c || state.view !== 'curve') return;
  const u = state.user[c.addr]; const t = state.tab; const meta = $('meta'); const hint = $('hint'); const go = $('go');
  const balR = $('bal-reserve'), balI = $('bal-ib'), balS = $('bal-staked');
  if (balR) balR.textContent = u ? fmtPlain(u.reserve) : '—'; if (balI) balI.textContent = u ? fmtPlain(u.ib) : '—'; if (balS) balS.textContent = u ? fmtPlain(u.staked) : '—';
  const amt = parseFloat($('amt')?.value || '0') || 0; const { slip, div } = limitsFromInputs();
  const rows = (arr) => arr.map(([k, v]) => `<div class="meta__row"><span>${k}</span><b>${v}</b></div>`).join('');
  const keep = '';
  let preview = null, ok = true, note = '';
  if (t === 'buy') {
    const q = quoteBuy(c, amt); $('out').value = q ? fmtPlain(q.out, { sig: 6 }) : '';
    const nx = q ? whatNext(c, amt, q) : null;
    meta.innerHTML = rows(q ? [
      ['Worth right now', fmt(nx.worthNow) + ' ' + c.id.label + ` <span class="dim">(you paid ${fmtPlain(amt)})</span>`],
      ['Price move from your mint', `<span class="down">${pct(q.impact)}</span>`],
      ['Fee, 0.5%', fmt(q.fee) + ' ' + c.ibSym],
    ] : []) + (nx ? `<div class="next"><div class="next__title">What happens to it next</div>
      <div class="meta__row"><span>If the next trader <b class="down">mints</b> the same</span><b>${fmt(nx.afterMint)} ${esc(c.id.label)} <span class="down">${pct(nx.afterMint / nx.worthNow - 1)}</span></b></div>
      <div class="meta__row"><span>If the next trader <b class="up">burns</b> the same</span><b>${fmt(nx.afterBurn)} ${esc(c.id.label)} <span class="up">${pct(nx.afterBurn / nx.worthNow - 1)}</span></b></div></div>` : '') + keep;
    if (q) preview = { supply: c.supply + q.out + q.fee, price: q.newPrice };
    if (u && amt > u.reserve) { ok = false; note = `Not enough ${c.id.label}.`; }
    if (amt > 0 && amt < 0.0001) { ok = false; note = 'Minimum 0.0001.'; }
    if (!c.isWeth && amt > 0) note = note || `Your first mint here asks MetaMask twice: once to allow ${c.id.label}, once to mint.`;
  } else if (t === 'sell') {
    const q = quoteSell(c, amt); $('out').value = q && isFinite(q.out) ? fmtPlain(q.out, { sig: 6 }) : '';
    meta.innerHTML = rows(q && isFinite(q.out) ? [['Worth at today\'s price', fmt(amt * c.price) + ' ' + c.id.label], ['You actually receive', fmt(q.out) + ' ' + c.id.label + ` <span class="dim">(after fee and your own price move)</span>`], ['Price move from your burn', `<span class="up">${pct(q.impact)}</span>`]] : []) + keep;
    if (q && isFinite(q.out)) preview = { supply: c.supply - (amt - q.fee), price: q.newPrice };
    if (u && amt > u.ib) { ok = false; note = `Not enough ${c.ibSym} in your wallet (staked tokens must be unstaked first).`; }
  } else if (t === 'add') {
    const q = quoteAddLp(c, amt); $('out').value = q ? fmtPlain(q.lp, { sig: 6 }) : '';
    meta.innerHTML = rows(q ? [['Your share of the market', (q.share * 100).toFixed(2) + '%'], [c.ibSym + ' credited to you', fmt(q.credit)], ['Fee, 0.5%', fmt(q.fee) + ' ' + c.id.label]] : []) + keep;
    if (u && u.lp > 0) { ok = false; note = 'You already hold an LP position on this curve. Remove it before adding a new one.'; }
    else if (u && amt > u.reserve) { ok = false; note = `Not enough ${c.id.label}.`; }
    else note = 'Your position gains whenever the price moves away from where you entered, up or down, and collects fees the whole time.';
  } else if (t === 'remove') {
    const q = quoteRemoveLp(c, u); $('amt').value = u ? fmtPlain(u.lp, { sig: 6 }) : ''; $('out').value = q ? fmtPlain(q.out, { sig: 6 }) : '';
    meta.innerHTML = rows(q ? [q.ibNeeded > 0 ? [`${c.ibSym} you return`, fmt(q.ibNeeded)] : [`${c.ibSym} you also receive`, fmt(q.ibOut)], ['Fee, 0.5%', fmt(q.fee) + ' ' + c.id.label]] : []) + keep;
    if (!u || !(u.lp > 0)) { ok = false; note = u ? 'You have no liquidity position on this market.' : ''; }
    else if (q.ibNeeded > 0 && u.ib < q.ibNeeded) { ok = false; note = `The price is lower than when you entered, so closing needs ${fmtPlain(q.ibNeeded)} ${c.ibSym} from your wallet. You hold ${fmtPlain(u.ib)}: mint the difference first, or wait for the price to recover.`; }
    else if (q.ibNeeded > 0) note = `The price is lower than when you entered, so ${fmtPlain(q.ibNeeded)} ${c.ibSym} comes out of your wallet when you close.`;
    else note = 'The price is higher than when you entered, so you get extra ' + c.ibSym + ' on top of your reserve.';
  } else if (t === 'stake') {
    meta.innerHTML = rows(amt > 0 ? [['Your share of all stakers', c.totalStaked + amt > 0 ? ((amt / (c.totalStaked + amt)) * 100).toFixed(2) + '%' : '—']] : []);
    if (u && amt > u.ib) { ok = false; note = `Not enough ${c.ibSym} in your wallet.`; }
    else note = c.totalStaked === 0 ? 'Nobody is staked yet. The first staker collects every staking fee this market has earned so far.' : 'Staked tokens cannot be burned until you unstake. Fees keep accruing while they are staked.';
  } else if (t === 'unstake') {
    meta.innerHTML = ''; if (u && amt > u.staked) { ok = false; note = 'Not enough staked.'; }
  } else if (t === 'claim') {
    meta.innerHTML = ''; const el = $('claimable'); if (el) el.textContent = u ? `${fmtPlain(u.rewardIb)} ${c.ibSym} + ${fmtPlain(u.rewardRes)} ${c.id.label}` : '—';
    if (u && u.rewardIb === 0 && u.rewardRes === 0) { ok = false; note = 'Nothing to claim yet. Fees appear here once trades happen while you are staked or providing liquidity.'; }
  }
  drawChart(preview);
  const needAmt = !['remove', 'claim'].includes(t);
  go.disabled = !wallet.account || !wallet.chainOk || !ok || (needAmt && !(amt > 0));
  hint.innerHTML = !wallet.account ? `<div class="note">Connect your wallet to trade.</div>` : !wallet.chainOk ? `<div class="note note--warn">Switch MetaMask to Robinhood Chain.</div>` : note ? `<div class="note ${ok ? '' : 'note--warn'}">${esc(note)}</div>` : '';
}

async function act() {
  const c = state.curve; const u = state.user[c.addr]; const t = state.tab; const me = wallet.account; const { slip, div } = limitsFromInputs();
  const amtStr = $('amt')?.value || '0'; const amt = parseFloat(amtStr) || 0;
  const resBase = c.reserveBalance18; const resLimits = encUint(resBase * BigInt(Math.floor((1 - div) * 1e6)) / 1000000n) + encUint(resBase * BigInt(Math.floor((1 + div) * 1e6)) / 1000000n);
  const P18 = (n) => fromNum(n, 18);
  let label, payload, cmd, value = '0x0', approveToken = null, approveAmt = 0n, approveSym = '';
  if (t === 'buy') {
    const q = quoteBuy(c, amt); const reserveIn = toUnits(amtStr, c.dec);
    payload = encAddr(me) + encUint(reserveIn) + encUint(0) + encUint(0) + encUint(P18(q.avgPrice * (1 + slip))) + resLimits;
    cmd = CMD.BUY; label = `Mint ${c.ibSym}`; if (c.isWeth) value = '0x' + reserveIn.toString(16); else { approveToken = c.reserveToken; approveAmt = reserveIn; approveSym = c.id.label; }
  } else if (t === 'sell') {
    const q = quoteSell(c, amt); const ibIn = toUnits(amtStr, 18);
    payload = encAddr(me) + encUint(ibIn) + encUint(P18(q.avgPrice * (1 - slip))) + encUint(0) + resLimits;
    cmd = CMD.SELL; label = `Burn ${c.ibSym}`; approveToken = c.ibToken; approveAmt = ibIn; approveSym = c.ibSym;
  } else if (t === 'add') {
    const reserveIn = toUnits(amtStr, c.dec);
    payload = encAddr(me) + encUint(reserveIn) + encUint(P18(c.price * (1 - slip))) + encUint(P18(c.price * (1 + slip)));
    cmd = CMD.ADD; label = 'Add liquidity'; if (c.isWeth) value = '0x' + reserveIn.toString(16); else { approveToken = c.reserveToken; approveAmt = reserveIn; approveSym = c.id.label; }
  } else if (t === 'remove') {
    const q = quoteRemoveLp(c, u); const ibIn = q.ibNeeded > 0 ? fromNum(q.ibNeeded * 1.0005, 18) : 0n;
    payload = encAddr(me) + encUint(ibIn) + encUint(P18(c.price * (1 - slip))) + encUint(P18(c.price * (1 + slip)));
    cmd = CMD.REMOVE; label = 'Remove liquidity'; if (ibIn > 0n) { approveToken = c.ibToken; approveAmt = ibIn; approveSym = c.ibSym; }
  } else if (t === 'stake') {
    const ibIn = toUnits(amtStr, 18); payload = encAddr(me) + encUint(ibIn); cmd = CMD.STAKE; label = `Stake ${c.ibSym}`; approveToken = c.ibToken; approveAmt = ibIn; approveSym = c.ibSym;
  } else if (t === 'unstake') {
    const ibIn = toUnits(amtStr, 18); payload = encAddr(me) + encUint(ibIn); cmd = CMD.UNSTAKE; label = `Unstake ${c.ibSym}`;
  } else if (t === 'claim') {
    payload = ''; cmd = CMD.CLAIM; label = 'Claim fees';
  }
  $('go').disabled = true;
  try {
    if (approveToken) await ensureAllowance(approveToken, ADDR.router, approveAmt, approveSym, log);
    await sendTx(label, { to: ADDR.router, data: encExecute(me, c.addr, c.isWeth, cmd, '0x' + payload), value }, log);
    state.curve = await loadCurve(c.addr); const i = state.curves.findIndex((x) => same(x.addr, c.addr)); if (i >= 0) state.curves[i] = state.curve;
    state.user[c.addr] = await loadUser(state.curve); renderStats(); renderPosition(); $('amt').value = ''; updateQuote();
  } finally { updateQuote(); }
}

/* ---------- Create ---------- */
let createSel = { addr: '', sym: '', name: '', dec: 18, bal: null, exists: null };
let resolveTimer = null;
async function showCreate() {
  state.view = 'create'; setNav('create');
  setTop('Open a market', 'Start the ib-version of any coin on Robinhood Chain. One market per coin, forever.');
  createSel = { addr: '', sym: '', name: '', dec: 18, bal: null, exists: null };
  $('view').innerHTML = `
    <div class="grid">
      <div class="card">
        <div class="card__title" style="margin-bottom:12px">Reserve coin</div>
        <input class="addr-input" id="tokenAddr" placeholder="Paste the coin's contract address (0x…)" spellcheck="false" autocomplete="off">
        <div id="tokenCard"></div>
        <ol class="steps">
          <li><span class="n">01</span><span><b>Paste the contract address</b> of the coin the market should run on. It has to be a token on Robinhood Chain.</span></li>
          <li><span class="n">02</span><span><b>Choose a seed.</b> The amount you put in fixes the opening price (2 ÷ seed) and supply (seed² ÷ 4) for good. A seed of 2 opens at 1 : 1.</span></li>
          <li><span class="n">03</span><span><b>Create.</b> One transaction. You receive the market's first liquidity position, with 0.01% burned so it can never be drained. No creation fee. One market per coin: whoever opens it first owns that first move.</span></li>
        </ol>
      </div>
      <div class="card">
        <div class="field"><div class="field__row"><span>Seed amount</span><span>Balance: <b id="cBal">—</b> <button id="cMax">MAX</button></span></div>
          <div class="field__main"><input class="field__input" id="cAmt" inputmode="decimal" placeholder="0"><span class="field__unit" id="cUnit">—</span></div></div>
        <div class="swap-arrow">↓</div>
        <div class="field"><div class="field__row"><span>You receive</span></div><div class="field__main"><input class="field__input" id="cOut" readonly placeholder="0"><span class="field__unit">LP position</span></div></div>
        <div class="meta" id="cMeta"></div>
        <div class="go-wrap"><button class="btn btn--wide" id="cGo" disabled>Open market</button></div>
        <div id="cHint"></div>
        <div class="log" id="log"></div>
      </div>
    </div>`;
  $('tokenAddr').addEventListener('input', () => { clearTimeout(resolveTimer); resolveTimer = setTimeout(() => resolveToken($('tokenAddr').value.trim()), 250); });
  $('cAmt').addEventListener('input', updateCreate);
  $('cMax').addEventListener('click', () => { if (createSel.bal !== null) { $('cAmt').value = String(createSel.bal); updateCreate(); } });
  $('cGo').addEventListener('click', () => createCurve().catch((e) => log(e.message, 'bad')));
  updateCreate();
}
async function resolveToken(addr) {
  const card = $('tokenCard'); if (!card) return;
  if (!addr) { createSel = { addr: '', sym: '', name: '', dec: 18, bal: null, exists: null }; card.innerHTML = ''; $('cUnit').textContent = '—'; updateCreate(); return; }
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) { createSel.addr = ''; card.innerHTML = `<div class="note note--warn">That is not a full address. It should be 0x followed by 40 letters and numbers.</div>`; updateCreate(); return; }
  card.innerHTML = `<div class="note">Looking up the token…</div>`;
  try {
    const [sym, dec, name] = await Promise.all([callStr(addr, SEL.symbol), callUint(addr, SEL.decimals), callStr(addr, SEL.name).catch(() => '')]);
    if (!sym) throw new Error('no symbol');
    const cur = await callAddr(ADDR.factory, SEL.getCurve + encAddr(addr)).catch(() => ZERO);
    createSel = { addr, sym, name: name || sym, dec: Number(dec), bal: null, exists: same(cur, ZERO) ? null : cur };
    const id = identity(sym, same(addr, ADDR.weth), same(addr, ADDR.weth) ? null : await iconFor(addr));
    $('cUnit').textContent = sym;
    card.innerHTML = `<div class="token">${id.html}<div><div class="token__name">${esc(createSel.name)}${createSel.name === sym ? '' : ` <span class="dim">${esc(sym)}</span>`}</div><div class="token__meta">${Number(dec)} decimals · ${link('address', addr)}</div></div>
      <div style="margin-left:auto;text-align:right;font-size:12.5px">${createSel.exists ? `<span class="down">market already open</span><br><a class="up" href="#/curve/${createSel.exists}">Go to ib${esc(id.label)} →</a>` : `<span class="up">no market yet</span>`}</div></div>`;
    loadCreateBalance();
  } catch (e) { createSel.addr = ''; card.innerHTML = `<div class="note note--bad">Nothing at that address looks like a token on Robinhood Chain.</div>`; $('cUnit').textContent = '—'; }
  updateCreate();
}
async function loadCreateBalance() {
  const el = $('cBal'); if (!el) return; createSel.bal = null; el.textContent = '—';
  if (!wallet.account || !createSel.addr) { updateCreate(); return; }
  createSel.bal = fromUnits(await callUint(createSel.addr, SEL.balanceOf + encAddr(wallet.account)), createSel.dec);
  el.textContent = fmtPlain(createSel.bal); updateCreate();
}
function updateCreate() {
  if (state.view !== 'create' || !$('cAmt')) return;
  const amt = parseFloat($('cAmt').value || '0') || 0; const g = geometry(amt); const sym = createSel.sym || 'coin';
  $('cOut').value = g && createSel.addr ? '1' : '';
  $('cMeta').innerHTML = (g && createSel.addr ? [['Opening price', `${fmt(g.price)} ${sym} per ib${sym}`], ['Opening supply', `${fmt(g.supply)} ib${sym}`], ['Credited to your position', `${fmt(g.credit)} ib${sym}`], ['Burned forever', '0.01% of the position'], ['Creation fee', 'none']] : [])
    .map(([k, v]) => `<div class="meta__row"><span>${k}</span><b>${v}</b></div>`).join('');
  let ok = true, note = '', cls = '';
  if (!createSel.addr) { ok = false; note = 'Paste a token address to begin.'; }
  else if (createSel.exists) { ok = false; note = `A market for ${sym} is already open.`; cls = 'note--warn'; }
  else if (amt > 0 && amt < 0.0001) { ok = false; note = 'Minimum seed is 0.0001.'; cls = 'note--warn'; }
  else if (createSel.bal !== null && amt > createSel.bal) { ok = false; note = `Not enough ${sym} in your wallet.`; cls = 'note--warn'; }
  else if (g && (g.price > 1000 || g.price < 0.001)) { note = `A ${fmtPlain(amt)} ${sym} seed opens the price at ${fmtPlain(g.price)} ${sym} per ib${sym}. The market works fine, the numbers just look unusual. A seed near 2 ${sym} opens at 1 : 1.`; cls = 'note--warn'; }
  if (createSel.exists) note += ` <a class="up" href="#/curve/${createSel.exists}">Open it →</a>`;
  $('cHint').innerHTML = !wallet.account ? `<div class="note">Connect your wallet to open a market.</div>` : !wallet.chainOk ? `<div class="note note--warn">Switch MetaMask to Robinhood Chain.</div>` : note ? `<div class="note ${cls}">${note}</div>` : '';
  $('cGo').disabled = !wallet.account || !wallet.chainOk || !ok || !(amt > 0);
  $('cGo').textContent = createSel.addr ? `Open the ib${sym} market` : 'Open market';
}
async function createCurve() {
  requireWallet(); const me = wallet.account; const amtStr = $('cAmt').value;
  $('cGo').disabled = true;
  try {
    const units = toUnits(amtStr, createSel.dec);
    await ensureAllowance(createSel.addr, ADDR.factory, units, createSel.sym, log);
    const data = SEL.createCurve + encUint(units) + encAddr(createSel.addr) + encAddr(me);
    await sendTx(`Open ib${createSel.sym}`, { to: ADDR.factory, data, value: '0x0' }, log);
    const curve = await callAddr(ADDR.factory, SEL.getCurve + encAddr(createSel.addr));
    log(`Market live at ${link('address', curve)}`, 'link');
    $('cHint').innerHTML = `<div class="note note--ok">Market is live. <a href="#/curve/${curve}">Go to ib${esc(createSel.sym)} →</a></div>`;
  } finally { updateCreate(); }
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */
buildRiskyMark();
if (NET === 'testnet') { const el = document.querySelector('.side__chain'); if (el) el.textContent = 'Robinhood Chain Testnet · 46630'; }
renderWallet('');
setTimeout(() => syncWallet(false), 300);
route();
