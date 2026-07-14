let Counter = class extends __Component {
  static __props = ['label', 'opt', 'step'];
  _init(props) {
    this.count = __state(0);
    this.label = __state(props.__bind_label__ ?? props.label);
    this.opt = __state(props.__bind_opt__ ?? props.opt);
    this.step = __state(props.__bind_step__ ?? props.step ?? 1);
    this.limit = 100;
    this.note = "plain";
    this.total = __computed(() => (this.count.value * 2));
    __effect(() => { return console.log(this.count.value); });
  }
  onClick(e) {
    return (this.count.value += this.step.value);
  }
  describe() {
    return `${this.note}: ${this.count.value} of ${this.limit}`;
  }
  beforeMount() {
    return console.log("mounting");
  }
  _create() {
    this._el0 = document.createElement('div');
    this._el0.setAttribute('data-part', 'Counter');
    this._el1 = document.createElement('h1');
    this._t0 = document.createTextNode("Counter");
    this._el1.appendChild(this._t0);
    this._el0.appendChild(this._el1);
    this._t1 = document.createTextNode('');
    this._el0.appendChild(this._t1);
    this._el2 = document.createElement('span');
    this._t2 = document.createTextNode('');
    this._el2.appendChild(this._t2);
    this._el2.className = 'badge';
    this._el0.appendChild(this._el2);
    this._el3 = document.createElement('button');
    this._el3.addEventListener('click', (e) => __batch(() => (this.onClick)(e)));
    this._t3 = document.createTextNode("Step");
    this._el3.appendChild(this._t3);
    this._el0.appendChild(this._el3);
    this._el0.className = 'card';
    return this._el0;
  }
  _setup() {
    __effect(() => { this._t1.data = String(this.count.value); });
    __effect(() => { this._t2.data = this.total.value; });
    __effect(() => { this._el3.toggleAttribute('disabled', !!(this.count.value > 5)); });
  }
};
let Panel = class extends __Component {
  _init(props) {
    this.active = __state(true);
  }
  _create() {
    this._el0 = document.createElement('div');
    this._el0.setAttribute('data-part', 'Panel');
    this._el1 = document.createElement('div');
    this._el1.id = 'main';
    this._t0 = document.createTextNode("id kid");
    this._el1.appendChild(this._t0);
    this._el0.appendChild(this._el1);
    this._el2 = document.createElement('div');
    this._el0.appendChild(this._el2);
    this._el3 = document.createElement('p');
    this._el3.className = "static";
    this._el0.appendChild(this._el3);
    this._el4 = document.createElement('section');
    this._el4.setAttribute('data-open', true);
    this._el4.setAttribute('data-my-thing', "x");
    this._el0.appendChild(this._el4);
    this._el5 = document.createElement('article');
    this._el5.setAttribute('data-lucide', "search");
    this._el0.appendChild(this._el5);
    this._el6 = document.createElement('form');
    this._el6.setAttribute('noValidate', true);
    this._el0.appendChild(this._el6);
    this._el7 = document.createElement('div');
    this._el7.setAttribute('role', "note");
    this._t1 = document.createTextNode("dot attributes");
    this._el7.appendChild(this._t1);
    this._el0.appendChild(this._el7);
    this._el8 = document.createElement('div');
    this._t2 = document.createTextNode("hyphenated");
    this._el8.appendChild(this._t2);
    this._el8.className = 'counter-display';
    this._el0.appendChild(this._el8);
    this._t3 = document.createTextNode('');
    this._el0.appendChild(this._t3);
    this._el0.className = 'shell';
    return this._el0;
  }
  _setup() {
    __effect(() => { this._el2.className = __clsx("grid", (this.active.value && "on")); });
    __effect(() => { this._t3.data = String(this.active.value); });
  }
};
let Badge = class extends __Component {
  static __props = ['size', 'step', 'name', 'nick', 'label'];
  _init(props) {
    this.size = __state(props.__bind_size__ ?? props.size);
    this.label = props.label ?? "x";
    this.step = __state(props.__bind_step__ ?? props.step ?? 1);
    this.name = __state(props.__bind_name__ ?? props.name ?? "anon");
    this.nick = __state(props.__bind_nick__ ?? props.nick ?? "nn");
  }
  onClick() {
    return 1;
  }
  _create() {
    this._frag0 = document.createDocumentFragment();
    this._el1 = document.createElement('button');
    this._el1.addEventListener('click', (e) => __batch(() => (this.onClick)(e)));
    this._t0 = document.createTextNode("go");
    this._el1.appendChild(this._t0);
    this._frag0.appendChild(this._el1);
    this._el2 = document.createElement('span');
    this._t1 = document.createTextNode('');
    this._el2.appendChild(this._t1);
    this._frag0.appendChild(this._el2);
    this._nodes = [...this._frag0.childNodes];
    return this._frag0;
  }
  _setup() {
    __effect(() => { this._t1.data = String(this.name.value); });
  }
};
let Two = class extends __Component {
  _init(props) {
  }
  _create() {
    this._frag0 = document.createDocumentFragment();
    this._el1 = document.createElement('div');
    this._t0 = document.createTextNode("a");
    this._el1.appendChild(this._t0);
    this._frag0.appendChild(this._el1);
    this._el2 = document.createElement('span');
    this._t1 = document.createTextNode("b");
    this._el2.appendChild(this._t1);
    this._frag0.appendChild(this._el2);
    this._nodes = [...this._frag0.childNodes];
    return this._frag0;
  }
};
let Roster = class extends __Component {
  _init(props) {
    this.items = __state([{id: 1, name: "a"}]);
    this.vis = __state(true);
    this.sel = __state("");
    this.el = __state(null);
  }
  _create() {
    let total;
    this._el0 = document.createElement('section');
    this._el0.setAttribute('data-part', 'Roster');
    total = this.items.value.length;
    this._t0 = document.createTextNode(String(total));
    this._el0.appendChild(this._t0);
    this._anchor1 = document.createComment('if');
    this._el0.appendChild(this._anchor1);
    this._el4 = document.createElement('ul');
    this._anchor5 = document.createComment('for');
    this._el4.appendChild(this._anchor5);
    this._el0.appendChild(this._el4);
    this._el8 = document.createElement('input');
    this._el8.setAttribute('type', "text");
    this._el8.addEventListener('input', (e) => { this.sel.value = e.target.value; });
    this._el0.appendChild(this._el8);
    this._el9 = document.createElement('div');
    this.el.value = this._el9;
    (this._refCleanups ??= []).push(() => __detachRef(this.el, this._el9));
    this._t5 = document.createTextNode("anchored");
    this._el9.appendChild(this._t5);
    this._el0.appendChild(this._el9);
    return this._el0;
  }
  _setup() {
    {
      const anchor = this._anchor1;
      let currentBlock = null;
      let showing = null;
      __effect(() => {
        const show = !!(this.vis.value);
        const want = show ? 'then' : 'else';
        if (want === showing) return;
        if (currentBlock) {
          const leaving = currentBlock;
          if (leaving._t) { __transition(leaving._first, leaving._t, 'leave', () => leaving.d(true)); }
          else { leaving.d(true); }
          currentBlock = null;
        }
        showing = want;
        if (want === 'then') {
          currentBlock = this.create_block_0(this);
          currentBlock.c();
          if (anchor.parentNode) currentBlock.m(anchor.parentNode, anchor.nextSibling);
          currentBlock.p(this);
          if (currentBlock._t) __transition(currentBlock._first, currentBlock._t, 'enter', undefined);
        }
        if (want === 'else') {
          currentBlock = this.create_block_1(this);
          currentBlock.c();
          if (anchor.parentNode) currentBlock.m(anchor.parentNode, anchor.nextSibling);
          currentBlock.p(this);
          if (currentBlock._t) __transition(currentBlock._first, currentBlock._t, 'enter', undefined);
        }
      });
      __ownerFrame().add(() => { if (currentBlock) { currentBlock.d(true); currentBlock = null; } });
    }
    {
      const __s = { blocks: [], keys: [] };
      __effect(() => {
        __reconcile(this._anchor5, __s, this.items.value, this, this.create_block_2, (item, idx) => item.id);
      });
      __ownerFrame().add(() => { for (const __b of __s.blocks) { try { __b.d(true); } catch {} } __s.blocks = []; __s.keys = []; __s.items = []; });
    }
    __effect(() => { this._el8.value = this.sel.value; });
  }
  create_block_0(ctx) {
    let _el2, _t1;
    return {
      c() {
        _el2 = document.createElement('div');
        this._t = "fade";
        _t1 = document.createTextNode("shown");
        _el2.appendChild(_t1);
        this._first = _el2;
      },
      m(target, anchor) {
        if (target) target.insertBefore(_el2, anchor);
      },
      p(ctx) {
      },
      d(detaching) {
        if (detaching) __detach(_el2);
      }
    };
  }
  create_block_1(ctx) {
    let _el3, _t2;
    return {
      c() {
        _el3 = document.createElement('p');
        _t2 = document.createTextNode("hidden");
        _el3.appendChild(_t2);
        this._first = _el3;
      },
      m(target, anchor) {
        if (target) target.insertBefore(_el3, anchor);
      },
      p(ctx) {
      },
      d(detaching) {
        if (detaching) __detach(_el3);
      }
    };
  }
  create_block_2(ctx, item, idx) {
    let _el6, _t3, _el7, _t4;
    let __fr;
    return {
      c() {
        _el6 = document.createElement('li');
        _t3 = document.createTextNode('');
        _el6.appendChild(_t3);
        _el7 = document.createElement('span');
        _t4 = document.createTextNode('');
        _el7.appendChild(_t4);
        _el6.appendChild(_el7);
        this._first = _el6;
      },
      m(target, anchor) {
        if (target) target.insertBefore(_el6, anchor);
      },
      p(ctx, __item, __idx) {
        item = __item; idx = __idx;
        if (__fr) __fr.dispose();
        const __o = __pushOwner(__fr = __ownerFrame());
        try {
          __effect(() => { _t3.data = String(item.name); });
          __effect(() => { _t4.data = idx; });
        } finally { __popOwner(__o); }
      },
      d(detaching) {
        if (__fr) { __fr.dispose(); __fr = null; }
        if (detaching) __detach(_el6);
      }
    };
  }
};
let Chooser = class extends __Component {
  _init(props) {
    this.n = __state(1);
  }
  _create() {
    this._el0 = document.createElement('div');
    this._el0.setAttribute('data-part', 'Chooser');
    this._anchor1 = document.createComment('if');
    this._el0.appendChild(this._anchor1);
    return this._el0;
  }
  _setup() {
    {
      const anchor = this._anchor1;
      let currentBlock = null;
      let showing = null;
      __effect(() => {
        const show = !!((this.n.value === 1));
        const want = show ? 'then' : 'else';
        if (want === showing) return;
        if (currentBlock) {
          const leaving = currentBlock;
          if (leaving._t) { __transition(leaving._first, leaving._t, 'leave', () => leaving.d(true)); }
          else { leaving.d(true); }
          currentBlock = null;
        }
        showing = want;
        if (want === 'then') {
          currentBlock = this.create_block_0(this);
          currentBlock.c();
          if (anchor.parentNode) currentBlock.m(anchor.parentNode, anchor.nextSibling);
          currentBlock.p(this);
          if (currentBlock._t) __transition(currentBlock._first, currentBlock._t, 'enter', undefined);
        }
        if (want === 'else') {
          currentBlock = this.create_block_1(this);
          currentBlock.c();
          if (anchor.parentNode) currentBlock.m(anchor.parentNode, anchor.nextSibling);
          currentBlock.p(this);
          if (currentBlock._t) __transition(currentBlock._first, currentBlock._t, 'enter', undefined);
        }
      });
      __ownerFrame().add(() => { if (currentBlock) { currentBlock.d(true); currentBlock = null; } });
    }
  }
  create_block_0(ctx) {
    let _el2, _t0;
    return {
      c() {
        _el2 = document.createElement('span');
        _t0 = document.createTextNode("one");
        _el2.appendChild(_t0);
        this._first = _el2;
      },
      m(target, anchor) {
        if (target) target.insertBefore(_el2, anchor);
      },
      p(ctx) {
      },
      d(detaching) {
        if (detaching) __detach(_el2);
      }
    };
  }
  create_block_1(ctx) {
    let _anchor3;
    let __fr;
    return {
      c() {
        _anchor3 = document.createComment('if');
        this._first = _anchor3;
      },
      m(target, anchor) {
        if (target) target.insertBefore(_anchor3, anchor);
      },
      p(ctx) {
        if (__fr) __fr.dispose();
        const __o = __pushOwner(__fr = __ownerFrame());
        try {
          {
            const anchor = _anchor3;
            let currentBlock = null;
            let showing = null;
            __effect(() => {
              const show = !!(((ctx.n.value === 2) || (ctx.n.value === 3)));
              const want = show ? 'then' : 'else';
              if (want === showing) return;
              if (currentBlock) {
                const leaving = currentBlock;
                if (leaving._t) { __transition(leaving._first, leaving._t, 'leave', () => leaving.d(true)); }
                else { leaving.d(true); }
                currentBlock = null;
              }
              showing = want;
              if (want === 'then') {
                currentBlock = ctx.create_block_2(ctx);
                currentBlock.c();
                if (anchor.parentNode) currentBlock.m(anchor.parentNode, anchor.nextSibling);
                currentBlock.p(ctx);
                if (currentBlock._t) __transition(currentBlock._first, currentBlock._t, 'enter', undefined);
              }
              if (want === 'else') {
                currentBlock = ctx.create_block_3(ctx);
                currentBlock.c();
                if (anchor.parentNode) currentBlock.m(anchor.parentNode, anchor.nextSibling);
                currentBlock.p(ctx);
                if (currentBlock._t) __transition(currentBlock._first, currentBlock._t, 'enter', undefined);
              }
            });
            __ownerFrame().add(() => { if (currentBlock) { currentBlock.d(true); currentBlock = null; } });
          }
        } finally { __popOwner(__o); }
      },
      d(detaching) {
        if (__fr) { __fr.dispose(); __fr = null; }
        if (detaching) __detach(_anchor3);
      }
    };
  }
  create_block_2(ctx) {
    let _el4, _t1;
    return {
      c() {
        _el4 = document.createElement('span');
        _t1 = document.createTextNode("few");
        _el4.appendChild(_t1);
        this._first = _el4;
      },
      m(target, anchor) {
        if (target) target.insertBefore(_el4, anchor);
      },
      p(ctx) {
      },
      d(detaching) {
        if (detaching) __detach(_el4);
      }
    };
  }
  create_block_3(ctx) {
    let _el5, _t2;
    return {
      c() {
        _el5 = document.createElement('span');
        _t2 = document.createTextNode("many");
        _el5.appendChild(_t2);
        this._first = _el5;
      },
      m(target, anchor) {
        if (target) target.insertBefore(_el5, anchor);
      },
      p(ctx) {
      },
      d(detaching) {
        if (detaching) __detach(_el5);
      }
    };
  }
};
let Chart = class extends __Component {
  _init(props) {
  }
  _create() {
    this._el0 = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this._el0.setAttribute('data-part', 'Chart');
    this._el0.setAttribute('viewBox', "0 0 10 10");
    this._el1 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    this._el1.setAttribute('cx', "5");
    this._el1.setAttribute('cy', "5");
    this._el1.setAttribute('r', "4");
    this._el0.appendChild(this._el1);
    return this._el0;
  }
};
let Chip = class extends __Component {
  static __props = ['label'];
  _init(props) {
    this.label = __state(props.__bind_label__ ?? props.label ?? "c");
  }
  fire() {
    return this.emit("pick", this.label.value);
  }
  _create() {
    this._el0 = document.createElement('span');
    this._el0.setAttribute('data-part', 'Chip');
    this._t0 = document.createTextNode('');
    this._el0.appendChild(this._t0);
    this._el0.className = 'chip';
    return this._el0;
  }
  _setup() {
    __effect(() => { this._t0.data = String(this.label.value); });
  }
};
let Deck = class extends __Component {
  _init(props) {
    this.name = __state("n");
  }
  onPick(e) {
    return (this.name.value = e.detail);
  }
  _create() {
    this._el0 = document.createElement('div');
    this._el0.setAttribute('data-part', 'Deck');
    { const __prev = __pushComponent(this); try {
    try {
    this._inst1 = new Chip({ label: this.name });
    if (this._inst1 && this._inst1._initFailed) {
      this._inst1 = null;
      this._el2 = document.createComment('rip:child-init-failed: Chip');
    } else if (this._inst1._mountCreate()) {
      this._el2 = this._inst1._root;
      (this._children || (this._children = [])).push(this._inst1);
    } else {
      this._inst1 = null;
      this._el2 = document.createComment('rip:child-error: Chip');
    }
    } catch (__childErr) {
      console.error('[Rip] Chip construction failed:', __childErr);
      this._inst1 = null;
      this._el2 = document.createComment('rip:child-error: Chip');
    }
    } finally { __popComponent(__prev); } }
    this._el0.appendChild(this._el2);
    { const __prev = __pushComponent(this); try {
    try {
    this._inst3 = new Chip({ label: "static", compact: true });
    if (this._inst3 && this._inst3._initFailed) {
      this._inst3 = null;
      this._el4 = document.createComment('rip:child-init-failed: Chip');
    } else if (this._inst3._mountCreate()) {
      this._el4 = this._inst3._root;
      (this._children || (this._children = [])).push(this._inst3);
    } else {
      this._inst3 = null;
      this._el4 = document.createComment('rip:child-error: Chip');
    }
    } catch (__childErr) {
      console.error('[Rip] Chip construction failed:', __childErr);
      this._inst3 = null;
      this._el4 = document.createComment('rip:child-error: Chip');
    }
    } finally { __popComponent(__prev); } }
    if (this._inst3) this._el4.addEventListener('pick', (e) => __batch(() => (this.onPick)(e)));
    this._el0.appendChild(this._el4);
    { const __prev = __pushComponent(this); try {
    try {
    this._inst5 = new Chip({ label: (this.name.value + "!") });
    if (this._inst5 && this._inst5._initFailed) {
      this._inst5 = null;
      this._el6 = document.createComment('rip:child-init-failed: Chip');
    } else if (this._inst5._mountCreate()) {
      this._el6 = this._inst5._root;
      (this._children || (this._children = [])).push(this._inst5);
    } else {
      this._inst5 = null;
      this._el6 = document.createComment('rip:child-error: Chip');
    }
    } catch (__childErr) {
      console.error('[Rip] Chip construction failed:', __childErr);
      this._inst5 = null;
      this._el6 = document.createComment('rip:child-error: Chip');
    }
    } finally { __popComponent(__prev); } }
    this._el0.appendChild(this._el6);
    { const __prev = __pushComponent(this); try {
    try {
    this._inst7 = new Chip({ __bind_label__: this.name });
    if (this._inst7 && this._inst7._initFailed) {
      this._inst7 = null;
      this._el8 = document.createComment('rip:child-init-failed: Chip');
    } else if (this._inst7._mountCreate()) {
      this._el8 = this._inst7._root;
      (this._children || (this._children = [])).push(this._inst7);
    } else {
      this._inst7 = null;
      this._el8 = document.createComment('rip:child-error: Chip');
    }
    } catch (__childErr) {
      console.error('[Rip] Chip construction failed:', __childErr);
      this._inst7 = null;
      this._el8 = document.createComment('rip:child-error: Chip');
    }
    } finally { __popComponent(__prev); } }
    this._el0.appendChild(this._el8);
    this._el9 = document.createElement('ul');
    this._anchor10 = document.createComment('for');
    this._el9.appendChild(this._anchor10);
    this._el0.appendChild(this._el9);
    this._el0.className = 'deck';
    return this._el0;
  }
  _setup() {
    if (this._inst1 && this._inst1._state === 'mounting') {
      this._el2 = this._inst1._mountSetup(document.createComment('rip:child-error: Chip'));
    }
    if (this._inst3 && this._inst3._state === 'mounting') {
      this._el4 = this._inst3._mountSetup(document.createComment('rip:child-error: Chip'));
    }
    if (this._inst5 && this._inst5._state === 'mounting') {
      this._el6 = this._inst5._mountSetup(document.createComment('rip:child-error: Chip'));
    }
    __effect(() => { if (this._inst5) this._inst5._updateProp('label', (this.name.value + "!")); });
    if (this._inst7 && this._inst7._state === 'mounting') {
      this._el8 = this._inst7._mountSetup(document.createComment('rip:child-error: Chip'));
    }
    {
      const __s = { blocks: [], keys: [] };
      __effect(() => {
        __reconcile(this._anchor10, __s, ["a", "b"], this, this.create_block_0, (item, i) => item);
      });
      __ownerFrame().add(() => { for (const __b of __s.blocks) { try { __b.d(true); } catch {} } __s.blocks = []; __s.keys = []; __s.items = []; });
    }
  }
  create_block_0(ctx, item, i) {
    let _inst11, _el12;
    let _factoryChildren = [];
    let __fr;
    return {
      c() {
        { const __prev = __pushComponent(ctx); try {
        try {
        _inst11 = new Chip({ label: item });
        if (_inst11 && _inst11._initFailed) {
          _inst11 = null;
          _el12 = document.createComment('rip:child-init-failed: Chip');
        } else if (_inst11._mountCreate()) {
          _el12 = _inst11._root;
          _factoryChildren.push(_inst11);
        } else {
          _inst11 = null;
          _el12 = document.createComment('rip:child-error: Chip');
        }
        } catch (__childErr) {
          console.error('[Rip] Chip construction failed:', __childErr);
          _inst11 = null;
          _el12 = document.createComment('rip:child-error: Chip');
        }
        } finally { __popComponent(__prev); } }
        this._first = _el12;
      },
      m(target, anchor) {
        if (target) target.insertBefore(_el12, anchor);
      },
      p(ctx, __item, __i) {
        item = __item; i = __i;
        if (__fr) __fr.dispose();
        const __o = __pushOwner(__fr = __ownerFrame());
        try {
          if (_inst11 && _inst11._state === 'mounting') {
            _el12 = _inst11._mountSetup(document.createComment('rip:child-error: Chip'));
            this._first = _el12;
          }
        } finally { __popOwner(__o); }
      },
      d(detaching) {
        for (const __c of _factoryChildren) { try { __c.unmount?.({removeDOM: detaching}); } catch (__e) { console.error('[Rip] factory child unmount error:', __e); } }
        _factoryChildren = [];
        if (__fr) { __fr.dispose(); __fr = null; }
        if (detaching) __detach(_el12);
      }
    };
  }
};
let Frame = class extends __Component {
  _init(props) {
  }
  _create() {
    this._el0 = document.createElement('div');
    this._el0.setAttribute('data-part', 'Frame');
    this._slot1 = this.children instanceof Node ? this.children : (this.children != null ? document.createTextNode(String(this.children)) : document.createComment(''));
    this._el0.appendChild(this._slot1);
    this._el0.className = 'frame';
    return this._el0;
  }
};
let Holder = class extends __Component {
  _init(props) {
  }
  _create() {
    this._el2 = document.createElement('p');
    this._t0 = document.createTextNode("projected");
    this._el2.appendChild(this._t0);
    { const __prev = __pushComponent(this); try {
    try {
    this._inst0 = new Frame({ children: this._el2 });
    if (this._inst0 && this._inst0._initFailed) {
      this._inst0 = null;
      this._el1 = document.createComment('rip:child-init-failed: Frame');
    } else if (this._inst0._mountCreate()) {
      this._el1 = this._inst0._root;
      (this._children || (this._children = [])).push(this._inst0);
    } else {
      this._inst0 = null;
      this._el1 = document.createComment('rip:child-error: Frame');
    }
    } catch (__childErr) {
      console.error('[Rip] Frame construction failed:', __childErr);
      this._inst0 = null;
      this._el1 = document.createComment('rip:child-error: Frame');
    }
    } finally { __popComponent(__prev); } }
    return this._el1;
  }
  _setup() {
    if (this._inst0 && this._inst0._state === 'mounting') {
      this._el1 = this._inst0._mountSetup(document.createComment('rip:child-error: Frame'));
    }
  }
};
let FancyBtn = class extends __Component {
  static __props = ['label'];
  static __extends = 'button';
  _init(props) {
    this.label = __state(props.__bind_label__ ?? props.label ?? "go");
  }
  _create() {
    this._el0 = document.createElement('button');
    this._inheritedEl = this._el0;
    this._applyRestToInheritedEl();
    this._el0.setAttribute('data-part', 'FancyBtn');
    this._t0 = document.createTextNode('');
    this._el0.appendChild(this._t0);
    return this._el0;
  }
  _setup() {
    __effect(() => { this._t0.data = String(this.label.value); });
  }
};
let GatedOrder = class extends __Component {
  static __gates = [{ path: 'orders', key: (params, query) => params.id }];
  _init(props) {
    this.order = __gateBind(this, 0);
    this.snapshot = __state(this.order.value);
  }
  _create() {
    return null;
  }
};