let chained, flush, logIt, nested, notify, wipe;

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
logIt = function(m) {
  emitLog(m);
  return;
};
notify = m => {
  sendOut(m);
  return;
};
flush = function() {
  drain();
  return;
};
chained = function(x) {
  track(x);
  return;
};
nested = function(a) {
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