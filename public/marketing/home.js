const root = document.querySelector(".rj-marketing");
const menu = root.querySelector(".mk-menu-toggle");
const nav = document.createElement("nav");
nav.id = "mk-mobile-nav";
nav.className = "mk-mobile-nav";
nav.setAttribute("aria-label", "Mobile navigation");
nav.hidden = true;
root.querySelectorAll(".mk-header a:not([aria-label])").forEach(link => nav.append(link.cloneNode(true)));
root.querySelector(".mk-header").append(nav);
function toggleMenu(open) {
  nav.hidden = !open;
  menu.setAttribute("aria-expanded", String(open));
  menu.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
}
menu.addEventListener("click", () => toggleMenu(nav.hidden));
nav.addEventListener("click", event => { if (event.target.closest("a")) toggleMenu(false); });
const frames = Array.from(root.querySelectorAll("iframe"));
const buttons = Array.from(root.querySelectorAll(".mk-scene-controls > div > button"));
const play = root.querySelector(".mk-scene-controls > button");
const dialog = root.querySelector("dialog");
let scene = 0;
let timer;
function send(frame) {
  frame.contentWindow?.postMessage({ type: "rejoyce:demo-scene", scene }, "*");
}
function select(index) {
  scene = index;
  buttons.forEach((button, i) => button.setAttribute("aria-pressed", String(i === scene)));
  frames.forEach(send);
}
function setPlaying(playing) {
  clearInterval(timer);
  timer = playing ? setInterval(() => select((scene + 1) % buttons.length), 5200) : undefined;
  root.dataset.tourPlaying = String(playing);
  play.setAttribute("aria-pressed", String(playing));
  play.setAttribute("aria-label", playing ? "Pause walkthrough" : "Play walkthrough");
}
buttons.forEach((button, i) => button.addEventListener("click", () => { setPlaying(false); select(i); }));
play.addEventListener("click", () => setPlaying(!timer));
window.addEventListener("message", event => {
  const frame = frames.find(frame => frame.contentWindow === event.source);
  if (!frame) return;
  if (event.data?.type === "rejoyce:demo-ready") send(frame);
  if (event.data?.type === "rejoyce:demo-interaction") setPlaying(false);
});
root.querySelector(".mk-preview-expand").addEventListener("click", () => { dialog.showModal(); frames.forEach(send); });
dialog.querySelector("button").addEventListener("click", () => dialog.close());
