let hit;

const count = __state(0);
const sum = __state((1 + 2));
const mood = __state("curious");
const banner = __state("hello");
const double = __computed(() => (count.value * 2));
const greeting = __computed(() => (banner.value + "!"));
const report = __computed(() => {
  let d = double.value + 1;
  return (d * 10);
});
const limit = __state(100);
const ratio = __computed(() => (limit.value / 4));
let plain = count.value + 1;
let viaCall = Math.max(count.value, 5);
let inArray = [count.value, sum.value];
let inObject = {n: count.value, count: count.value};
let keyed = {"count": count.value};
const nested = __computed(() => (double.value + sum.value));
count.value = 5;
count.value += 2;
(count.value++);
(--count.value);
mood.value = "bright";
const user = __state({name: "Ada", tags: [1, 2]});
let who = user.value.name;
let firstTag = user.value.tags[0];
user.value.name = "Bob";
if (count.value > 3) {
  hit = count.value;
}
while (count.value > 6) {
  count.value -= 1;
}
const items = __state([10, 20]);
let total = 0;
for (let it of items.value) {
  total += it;
}
let doubled = (() => {
  const result = [];
  for (let x of items.value) {
    result.push((x * 2));
  }
  return result;
})();
function bump() {
  return (count.value += 1);
}
let peek = function() {
  return (count.value + sum.value);
};
bump();
function localState() {
  const z = __state(7);
  return (z.value + 1);
}
let snap = (function() {
  return count.value;
})();
const fallback = __state(((count.value > 0) ? 0 : undefined));