let wipe;

function save(x) {
  register(x);
  return;
}
function tick() {
  let count;
  count = 0;
  return;
}
function typed(x) {
  bump(x);
  return;
}
let logIt = function(m) {
  emitLog(m);
  return;
};
let notify = m => {
  sendOut(m);
  return;
};
let flush = function() {
  drain();
  return;
};
let chained = function(x) {
  track(x);
  return;
};
let nested = function(a) {
  let inner = function(b) {
    return (b + 1);
  };
  inner(a);
  return;
};
let alias = wipe = function() {
  reset();
  return;
};
async function store(u) {
  await persist(u);
  return;
}