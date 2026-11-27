// The v2 code builder: lowerings write through it. emit() appends text;
// mark() wraps a role's emission. This builder records no mapping row:
// a mark is one frame push and pop. MappingBuilder (mapping.js) records
// a MappingStore row per mark when mappings are asked for.
//
// TS-only regions and face echoes are recorded either way: the strip
// gate and the diagnostic mapper read them on every TS-face compile.
//
// Output accumulates as chunks, joined once when read. Every mark starts
// at a chunk boundary, so a recording builder compares a frame's text
// chunk by chunk and never joins the growing buffer.

export class Builder {
  constructor() {
    this.chunks = [];
    this.length = 0;
    // Open frames, innermost last: here nodeId and role pairs.
    this.frames = [];
    this.tsRegions = [];
    this.tsDepth = 0;
    this.echoSpans = [];
  }

  get offset() {
    return this.length;
  }

  // The output so far. The chunks collapse to one only while no frame is
  // open: an open frame holds chunk indices a collapse would invalidate.
  get code() {
    if (this.frames.length !== 0) return this.chunks.join('');
    if (this.chunks.length !== 1) {
      this.chunks = [this.chunks.join('')];
      this.renumbered();
    }
    return this.chunks[0] ?? '';
  }

  // The chunks were joined into one.
  renumbered() {}

  // The node the innermost open frame maps, or null outside every frame.
  get frameNode() {
    const f = this.frames;
    return f.length === 0 ? null : f[f.length - 2];
  }

  emit(text) {
    this.chunks.push(text);
    this.length += text.length;
    return this;
  }

  beginMark(nodeId, role) {
    this.frames.push(nodeId, role);
  }

  endMark() {
    this.frames.length -= 2;
  }

  mark(nodeId, role, fn) {
    this.beginMark(nodeId, role);
    fn();
    this.endMark();
  }

  // A mark whose source span the caller supplies, for the roles the
  // RoleStore does not hold (CALLER_SPAN_ROLES).
  markSpan(nodeId, role, sourceStart, sourceEnd, fn) {
    this.beginMark(nodeId, role);
    fn();
    this.endMark();
  }

  // A leaf (a name, number, string or literal word) emitted as `text`
  // from node `leafId`. A builder that maps leaves records the leaf's own
  // occurrence (MappingBuilder.leaf).
  leaf(leafId, text) {
    this.emit(text);
  }

  tsOnly(fn) {
    const start = this.length;
    this.tsDepth++;
    fn();
    this.tsDepth--;
    if (this.tsDepth === 0 && this.length > start) this.tsRegions.push([start, this.length]);
  }

  echo(fn) {
    const start = this.length;
    fn();
    if (this.length > start) this.echoSpans.push([start, this.length]);
  }
}
