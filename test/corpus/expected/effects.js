const count = __state(0);
const label = __state("tick");
__effect(() => { console.log(count.value); });
__effect(() => { console.log(label.value); });
__effect(() => {
  let snapshot = count.value * 2;
  return console.log(snapshot);
});
const watcher = __effect(() => { console.log(count.value); });
const logger = __effect(() => {
  return console.log((label.value + ": ") + count.value);
});
const typedHandle = __effect(() => { console.log(count.value); });
__effect((function() {
  return console.log(count.value);
}));
const fat = __effect(() => console.log(count.value));
__effect(() => { ((count.value > 0) ? console.log(count.value) : undefined); });
const guarded = __effect(() => { (!(count.value > 5) ? console.log(count.value) : undefined); });
let total = 0;
__effect(() => { (total = total + count.value); });
const ticker = __effect(() => {
  let id = setInterval(function() {
    return console.log(label.value);
  }, 1000);
  return (function() {
    return clearInterval(id);
  });
});
__effect(() => {
  let seen = count.value;
  return __effect(() => { console.log(seen); });
});
let stop = __effect(() => { console.log(count.value); });
stop();
if (count.value > 0) {
  __effect(() => { console.log("positive"); });
}
let makeWatcher = function() {
  return __effect(() => { console.log(count.value); });
};
watcher();