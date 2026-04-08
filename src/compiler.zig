//! Rip Compiler — S-expression to Zig Source Emitter
//!
//! Walks the parsed S-expression tree and emits readable Zig source.
//! Type resolution pre-pass builds a symbol table from fun/sub
//! declarations for void-call detection, var binding type inference,
//! and declaration diagnostics at public/extern boundaries.

const std = @import("std");
const parser = @import("parser.zig");
const rip = @import("rip.zig");

const Sexp = parser.Sexp;
const Tag = rip.Tag;
const Writer = std.Io.Writer;

const MAX_NAMES = 128;

const FnInfo = struct {
    name: []const u8,
    ret: Sexp,
    is_void: bool,
    is_pub: bool,
    is_extern: bool,
    has_untyped_params: bool,
};

pub const Compiler = struct {
    source: []const u8,
    depth: u32 = 0,

    // Scope tracking: names assigned more than once need `var`
    mutated: [MAX_NAMES][]const u8 = undefined,
    mut_count: usize = 0,
    bound: [MAX_NAMES][]const u8 = undefined,
    bound_count: usize = 0,

    // Symbol table: function declarations from pre-pass
    fn_info: [MAX_NAMES]FnInfo = undefined,
    fn_count: usize = 0,

    pub fn init(source: []const u8) Compiler {
        return .{ .source = source };
    }

    // =========================================================================
    // Entry point
    // =========================================================================

    pub fn compile(self: *Compiler, sexp: Sexp, w: *Writer) Writer.Error!void {
        if (sexp != .list) return;
        const items = sexp.list;
        if (items.len == 0 or items[0] != .tag) return;
        if (items[0].tag != .@"module") return;
        self.buildSymbolTable(items[1..]);
        self.emitDeclWarnings();
        try self.emitModule(items[1..], w);
    }

    // =========================================================================
    // Module
    // =========================================================================

    fn emitModule(self: *Compiler, children: []const Sexp, w: *Writer) Writer.Error!void {
        try w.writeAll("const std = @import(\"std\");\n");
        for (children) |child| {
            try w.writeAll("\n");
            try self.emitTopLevel(child, w);
        }
    }

    fn emitTopLevel(self: *Compiler, sexp: Sexp, w: *Writer) Writer.Error!void {
        if (sexp != .list) return;
        const items = sexp.list;
        if (items.len == 0 or items[0] != .tag) return;
        switch (items[0].tag) {
            .@"fun" => try self.emitFun(items[1..], w),
            .@"sub" => try self.emitSub(items[1..], w),
            .@"use" => {}, // handled by module preamble
            .@"pub", .@"export" => if (items.len > 1) {
                try w.writeAll(@tagName(items[0].tag));
                try w.writeAll(" ");
                try self.emitTopLevel(items[1], w);
            },
            .@"extern" => if (items.len > 1) {
                // extern struct → const Name = extern struct { ... }
                if (items[1] == .list and items[1].list.len > 0 and
                    items[1].list[0] == .tag and items[1].list[0].tag == .@"struct")
                {
                    try self.emitExternStruct(items[1].list[1..], w);
                } else {
                    try w.writeAll("extern ");
                    try self.emitTopLevel(items[1], w);
                }
            },
            .@"callconv" => if (items.len > 2) {
                try self.emitTopLevel(items[2], w);
            },
            .@"extern_var" => if (items.len > 1) {
                const name = self.txt(items[1]);
                try w.print("extern var {s}: ", .{name});
                if (items.len > 2) try self.emitTyperef(items[2], w);
                try w.writeAll(";\n");
            },
            .@"zig" => if (items.len > 1) {
                const raw = self.source[items[1].src.pos..][0..items[1].src.len];
                try self.writeIndent(w);
                if (raw.len >= 2) try w.writeAll(raw[1 .. raw.len - 1]);
                try w.writeAll("\n");
            },
            .@"errors" => try self.emitErrorSet(items[1..], w),
            .@"test" => try self.emitTest(items[1..], w),
            .@"enum" => try self.emitEnum(items[1..], w),
            .@"struct" => try self.emitStruct(items[1..], w),
            .@"packed" => if (items.len > 1) {
                if (items[1] == .list and items[1].list.len > 0 and
                    items[1].list[0] == .tag and items[1].list[0].tag == .@"struct")
                {
                    try self.emitPackedStruct(items[1].list[1..], w);
                } else {
                    try w.writeAll("packed ");
                    try self.emitTopLevel(items[1], w);
                }
            },
            .@"type" => try self.emitTypeDef(items[1..], w),
            else => try self.emitStmt(sexp, w),
        }
    }

    // =========================================================================
    // Declarations
    // =========================================================================

    fn emitFun(self: *Compiler, children: []const Sexp, w: *Writer) Writer.Error!void {
        // (fun name params ret body) — params and ret can be nil
        if (children.len < 4) return;
        const name = self.txt(children[0]);
        const params = children[1];
        const ret = children[2];
        const body = children[3];

        self.resetScope();
        self.scanAssignments(body);

        if (std.mem.eql(u8, name, "main")) try w.writeAll("pub ");
        try w.writeAll("fn ");
        try w.writeAll(name);
        try w.writeAll("(");
        if (params != .nil) try self.emitParams(params, w);
        try w.writeAll(") ");
        if (ret != .nil) {
            try self.emitTyperef(ret, w);
        } else {
            try w.writeAll("i64");
        }
        try w.writeAll(" {\n");

        self.depth += 1;
        try self.emitBody(body, true, w);
        self.depth -= 1;
        try self.writeIndent(w);
        try w.writeAll("}\n");
    }

    fn emitSub(self: *Compiler, children: []const Sexp, w: *Writer) Writer.Error!void {
        // (sub name params ret body) — params and ret can be nil
        if (children.len < 4) return;
        const name = self.txt(children[0]);
        const is_main = std.mem.eql(u8, name, "main");
        const params = children[1];
        const body = children[3];

        self.resetScope();
        self.scanAssignments(body);

        if (is_main) try w.writeAll("pub ");
        try w.writeAll("fn ");
        try w.writeAll(name);
        try w.writeAll("(");
        if (params != .nil) try self.emitParams(params, w);
        try w.writeAll(") void {\n");

        self.depth += 1;
        try self.emitBody(body, false, w);
        self.depth -= 1;
        try self.writeIndent(w);
        try w.writeAll("}\n");
    }

    fn emitParams(self: *Compiler, sexp: Sexp, w: *Writer) Writer.Error!void {
        if (sexp != .list) {
            try w.writeAll(self.txt(sexp));
            try w.writeAll(": i64");
            return;
        }
        for (sexp.list, 0..) |param, i| {
            if (i > 0) try w.writeAll(", ");
            if (param == .list and param.list.len >= 3 and
                param.list[0] == .tag and param.list[0].tag == .@":")
            {
                try w.writeAll(self.txt(param.list[1]));
                try w.writeAll(": ");
                try self.emitTyperef(param.list[2], w);
            } else {
                try w.writeAll(self.txt(param));
                try w.writeAll(": i64");
            }
        }
    }

    fn emitUse(self: *Compiler, children: []const Sexp, w: *Writer) Writer.Error!void {
        if (children.len == 0) return;
        const name = self.txt(children[0]);
        try w.print("const {s} = @import(\"{s}\");\n", .{ name, name });
    }

    fn emitEnum(self: *Compiler, children: []const Sexp, w: *Writer) Writer.Error!void {
        if (children.len < 1) return;
        const name = self.txt(children[0]);
        const members = children[1..];

        // Detect if any member is typed → emit union(enum), else plain enum
        var has_typed = false;
        for (members) |m| {
            if (m == .list and m.list.len > 0 and m.list[0] == .tag and
                (m.list[0].tag == .@"typed" or m.list[0].tag == .@":"))
                has_typed = true;
        }

        if (has_typed) {
            try w.print("const {s} = union(enum) {{\n", .{name});
            self.depth += 1;
            for (members) |m| {
                try self.writeIndent(w);
                if (m == .list and m.list.len >= 3 and m.list[0] == .tag and
                    (m.list[0].tag == .@"typed" or m.list[0].tag == .@":"))
                {
                    try w.writeAll(self.txt(m.list[1]));
                    try w.writeAll(": ");
                    try self.emitTyperef(m.list[2], w);
                    try w.writeAll(",\n");
                } else {
                    try w.writeAll(self.txt(m));
                    try w.writeAll(": void,\n");
                }
            }
            self.depth -= 1;
            try w.writeAll("};\n");
        } else {
            var has_valued = false;
            for (members) |m| {
                if (m == .list and m.list.len > 0 and m.list[0] == .tag and
                    m.list[0].tag == .@"valued")
                    has_valued = true;
            }
            if (has_valued) {
                try w.print("const {s} = enum(i64) {{\n", .{name});
            } else {
                try w.print("const {s} = enum {{\n", .{name});
            }
            self.depth += 1;
            for (members) |m| {
                try self.writeIndent(w);
                if (m == .list and m.list.len >= 3 and m.list[0] == .tag and
                    m.list[0].tag == .@"valued")
                {
                    try w.writeAll(self.txt(m.list[1]));
                    try w.writeAll(" = ");
                    try self.emitExpr(m.list[2], w);
                    try w.writeAll(",\n");
                } else {
                    try w.writeAll(self.txt(m));
                    try w.writeAll(",\n");
                }
            }
            self.depth -= 1;
            try w.writeAll("};\n");
        }
    }

    fn emitStruct(self: *Compiler, children: []const Sexp, w: *Writer) Writer.Error!void {
        if (children.len < 1) return;
        try w.print("const {s} = struct {{\n", .{self.txt(children[0])});
        try self.emitStructBody(children[1..], true, w);
    }

    fn emitExternStruct(self: *Compiler, children: []const Sexp, w: *Writer) Writer.Error!void {
        if (children.len < 1) return;
        try w.print("const {s} = extern struct {{\n", .{self.txt(children[0])});
        try self.emitStructBody(children[1..], false, w);
    }

    fn emitPackedStruct(self: *Compiler, children: []const Sexp, w: *Writer) Writer.Error!void {
        if (children.len < 1) return;
        try w.print("const {s} = packed struct {{\n", .{self.txt(children[0])});
        try self.emitStructBody(children[1..], false, w);
    }

    fn emitStructBody(self: *Compiler, members: []const Sexp, allow_methods: bool, w: *Writer) Writer.Error!void {
        self.depth += 1;
        for (members) |item| {
            if (item == .list and item.list.len > 0 and item.list[0] == .tag) {
                const tag = item.list[0].tag;
                if (tag == .@":" or tag == .@"default" or tag == .@"aligned") {
                    try self.writeIndent(w);
                    try w.writeAll(self.txt(item.list[1]));
                    try w.writeAll(": ");
                    try self.emitTyperef(item.list[2], w);
                    if (tag == .@"aligned" and item.list.len >= 4) {
                        try w.writeAll(" align(");
                        try self.emitExpr(item.list[3], w);
                        try w.writeAll(")");
                    }
                    if (tag == .@"default" and item.list.len >= 4) {
                        try w.writeAll(" = ");
                        try self.emitExpr(item.list[3], w);
                    }
                    try w.writeAll(",\n");
                    continue;
                }
                if (allow_methods) {
                    if (tag == .@"fun") {
                        try w.writeAll("\n");
                        try self.writeIndent(w);
                        try self.emitFun(item.list[1..], w);
                        continue;
                    }
                    if (tag == .@"sub") {
                        try w.writeAll("\n");
                        try self.writeIndent(w);
                        try self.emitSub(item.list[1..], w);
                        continue;
                    }
                }
            }
            try self.writeIndent(w);
            try w.writeAll(self.txt(item));
            if (allow_methods) try w.writeAll(": i64");
            try w.writeAll(",\n");
        }
        self.depth -= 1;
        try w.writeAll("};\n");
    }

    fn emitErrorSet(self: *Compiler, children: []const Sexp, w: *Writer) Writer.Error!void {
        if (children.len < 1) return;
        const name = self.txt(children[0]);
        try w.print("const {s} = error{{\n", .{name});
        self.depth += 1;
        for (children[1..]) |member| {
            try self.writeIndent(w);
            try w.writeAll(self.txt(member));
            try w.writeAll(",\n");
        }
        self.depth -= 1;
        try w.writeAll("};\n");
    }

    fn emitTest(self: *Compiler, children: []const Sexp, w: *Writer) Writer.Error!void {
        if (children.len < 2) return;
        try w.writeAll("test ");
        try self.emitExpr(children[0], w);
        try w.writeAll(" {\n");
        self.depth += 1;
        try self.emitBody(children[1], false, w);
        self.depth -= 1;
        try w.writeAll("}\n");
    }

    fn emitTypeDef(self: *Compiler, children: []const Sexp, w: *Writer) Writer.Error!void {
        if (children.len < 2) return;
        const name = self.txt(children[0]);
        try w.print("const {s} = ", .{name});
        try self.emitTyperef(children[1], w);
        try w.writeAll(";\n");
    }

    fn emitTyperef(self: *Compiler, sexp: Sexp, w: *Writer) Writer.Error!void {
        switch (sexp) {
            .src => |s| try w.writeAll(self.source[s.pos..][0..s.len]),
            .list => |items| {
                if (items.len < 2 or items[0] != .tag) return;
                switch (items[0].tag) {
                    .@"?" => {
                        try w.writeAll("?");
                        try self.emitTyperef(items[1], w);
                    },
                    .@"ptr" => {
                        try w.writeAll("*");
                        try self.emitTyperef(items[1], w);
                    },
                    .@"slice" => {
                        try w.writeAll("[]");
                        try self.emitTyperef(items[1], w);
                    },
                    .@"error_union" => {
                        try w.writeAll("!");
                        try self.emitTyperef(items[1], w);
                    },
                    .@"volatile_ptr" => {
                        try w.writeAll("*volatile ");
                        try self.emitTyperef(items[1], w);
                    },
                    .@"many_ptr" => {
                        try w.writeAll("[*]");
                        try self.emitTyperef(items[1], w);
                    },
                    .@"array_type" => if (items.len >= 3) {
                        try w.writeAll("[");
                        try self.emitExpr(items[1], w);
                        try w.writeAll("]");
                        try self.emitTyperef(items[2], w);
                    },
                    .@"sentinel_ptr" => if (items.len >= 3) {
                        try w.writeAll("[*:");
                        try self.emitExpr(items[1], w);
                        try w.writeAll("]");
                        try self.emitTyperef(items[2], w);
                    },
                    .@"aligned" => if (items.len >= 3) {
                        try self.emitTyperef(items[1], w);
                        try w.writeAll(" align(");
                        try self.emitExpr(items[2], w);
                        try w.writeAll(")");
                    },
                    else => try self.emitExpr(sexp, w),
                }
            },
            else => try self.emitExpr(sexp, w),
        }
    }

    // =========================================================================
    // Scope tracking
    // =========================================================================

    fn resetScope(self: *Compiler) void {
        self.mut_count = 0;
        self.bound_count = 0;
        resetEmitted();
    }

    /// Pre-scan a sexp tree to find names assigned more than once.
    /// Names that appear as LHS of (= ...) or (+= ...) etc. multiple
    /// times get marked as mutated so the emitter uses `var`.
    fn scanAssignments(self: *Compiler, sexp: Sexp) void {
        if (sexp != .list) return;
        const items = sexp.list;
        if (items.len == 0 or items[0] != .tag) return;
        const tag = items[0].tag;

        switch (tag) {
            .@"=" => if (items.len >= 2) {
                const name = self.txt(items[1]);
                if (self.nameIn(self.bound[0..self.bound_count], name)) {
                    self.addMutated(name);
                } else {
                    self.addBound(name);
                }
            },
            .@"+=", .@"-=", .@"*=", .@"/=" => if (items.len >= 2) {
                self.addMutated(self.txt(items[1]));
            },
            else => {},
        }

        for (items[1..]) |child| {
            self.scanAssignments(child);
        }
    }

    fn isMutated(self: *const Compiler, name: []const u8) bool {
        return self.nameIn(self.mutated[0..self.mut_count], name);
    }

    fn addMutated(self: *Compiler, name: []const u8) void {
        if (!self.nameIn(self.mutated[0..self.mut_count], name)) {
            if (self.mut_count < MAX_NAMES) {
                self.mutated[self.mut_count] = name;
                self.mut_count += 1;
            }
        }
    }

    fn addBound(self: *Compiler, name: []const u8) void {
        if (self.bound_count < MAX_NAMES) {
            self.bound[self.bound_count] = name;
            self.bound_count += 1;
        }
    }

    fn nameIn(self: *const Compiler, list: []const []const u8, name: []const u8) bool {
        _ = self;
        for (list) |n| {
            if (std.mem.eql(u8, n, name)) return true;
        }
        return false;
    }

    // Track which names have been emitted as declarations in the current function
    var emitted_names: [MAX_NAMES][]const u8 = undefined;
    var emitted_count: usize = 0;

    fn resetEmitted() void {
        emitted_count = 0;
    }

    fn markEmitted(name: []const u8) void {
        if (emitted_count < MAX_NAMES) {
            emitted_names[emitted_count] = name;
            emitted_count += 1;
        }
    }

    fn isEmitted(name: []const u8) bool {
        for (emitted_names[0..emitted_count]) |n| {
            if (std.mem.eql(u8, n, name)) return true;
        }
        return false;
    }

    // =========================================================================
    // Type resolution pre-pass
    // =========================================================================

    fn buildSymbolTable(self: *Compiler, children: []const Sexp) void {
        for (children) |child| {
            self.scanDeclTypes(child, false, false);
        }
    }

    fn scanDeclTypes(self: *Compiler, sexp: Sexp, is_pub: bool, is_extern: bool) void {
        if (sexp != .list) return;
        const items = sexp.list;
        if (items.len == 0 or items[0] != .tag) return;
        switch (items[0].tag) {
            .@"sub" => if (items.len >= 5) {
                const params = items[2];
                self.addFnInfo(.{
                    .name = self.txt(items[1]),
                    .ret = .nil,
                    .is_void = true,
                    .is_pub = is_pub,
                    .is_extern = is_extern,
                    .has_untyped_params = self.hasUntypedParams(params),
                });
            },
            .@"fun" => if (items.len >= 5) {
                const ret = items[3];
                const params = items[2];
                self.addFnInfo(.{
                    .name = self.txt(items[1]),
                    .ret = ret,
                    .is_void = self.isVoidType(ret),
                    .is_pub = is_pub,
                    .is_extern = is_extern,
                    .has_untyped_params = self.hasUntypedParams(params),
                });
            },
            .@"pub", .@"export" => if (items.len > 1) {
                self.scanDeclTypes(items[1], true, is_extern);
            },
            .@"extern" => if (items.len > 1) {
                self.scanDeclTypes(items[1], is_pub, true);
            },
            .@"callconv" => if (items.len > 2) {
                self.scanDeclTypes(items[2], is_pub, is_extern);
            },
            else => {},
        }
    }

    fn hasUntypedParams(_: *const Compiler, params: Sexp) bool {
        if (params == .nil) return false;
        if (params != .list) return true;
        for (params.list) |param| {
            if (param != .list or param.list.len < 3 or param.list[0] != .tag or param.list[0].tag != .@":")
                return true;
        }
        return false;
    }

    fn isVoidType(self: *const Compiler, ret: Sexp) bool {
        if (ret == .nil) return false;
        if (ret == .src) return std.mem.eql(u8, self.txt(ret), "void");
        if (ret == .list) {
            const items = ret.list;
            if (items.len >= 2 and items[0] == .tag and items[0].tag == .@"error_union")
                return self.isVoidType(items[1]);
        }
        return false;
    }

    fn addFnInfo(self: *Compiler, info: FnInfo) void {
        if (self.fn_count < MAX_NAMES) {
            self.fn_info[self.fn_count] = info;
            self.fn_count += 1;
        }
    }

    fn lookupFn(self: *const Compiler, name: []const u8) ?FnInfo {
        for (0..self.fn_count) |i| {
            if (std.mem.eql(u8, self.fn_info[i].name, name)) return self.fn_info[i];
        }
        return null;
    }

    fn isVoidCall(self: *const Compiler, sexp: Sexp) bool {
        if (sexp != .list) return false;
        const items = sexp.list;
        if (items.len < 2 or items[0] != .tag) return false;
        if (items[0].tag != .@"call") return false;
        if (items[1] != .src) return false;
        const name = self.txt(items[1]);
        if (std.mem.eql(u8, name, "print")) return true;
        if (self.lookupFn(name)) |info| return info.is_void;
        return false;
    }

    fn typeOf(self: *const Compiler, sexp: Sexp) ?Sexp {
        switch (sexp) {
            .src => |s| {
                const text = self.source[s.pos..][0..s.len];
                if (text.len > 0 and text[0] >= '0' and text[0] <= '9') return null;
                if (text.len >= 2 and (text[0] == '\'' or text[0] == '"')) return null;
                if (std.mem.eql(u8, text, "true") or std.mem.eql(u8, text, "false"))
                    return Sexp{ .str = "bool" };
                return null;
            },
            .list => |items| {
                if (items.len < 2 or items[0] != .tag) return null;
                switch (items[0].tag) {
                    .@"call" => {
                        if (items[1] != .src) return null;
                        const name = self.txt(items[1]);
                        if (self.lookupFn(name)) |info| {
                            if (info.is_void) return null;
                            if (info.ret != .nil) return info.ret;
                        }
                        return null;
                    },
                    .@"neg" => return null,
                    .@"not" => return Sexp{ .str = "bool" },
                    else => return null,
                }
            },
            else => return null,
        }
    }

    fn emitDeclWarnings(self: *const Compiler) void {
        for (0..self.fn_count) |i| {
            const info = self.fn_info[i];
            if (info.is_pub and info.has_untyped_params) {
                std.debug.print("warning: pub function '{s}' has untyped parameters\n", .{info.name});
            }
            if (info.is_pub and !info.is_void and info.ret == .nil) {
                std.debug.print("warning: pub function '{s}' has no explicit return type (defaults to i64)\n", .{info.name});
            }
            if (info.is_extern and info.has_untyped_params) {
                std.debug.print("warning: extern function '{s}' has untyped parameters\n", .{info.name});
            }
        }
    }

    // =========================================================================
    // Block body
    // =========================================================================

    fn emitBody(self: *Compiler, sexp: Sexp, return_last: bool, w: *Writer) Writer.Error!void {
        if (sexp != .list) return;
        const items = sexp.list;
        if (items.len == 0 or items[0] != .tag) return;
        if (items[0].tag != .@"block") return;

        const stmts = items[1..];
        for (stmts, 0..) |stmt, i| {
            const is_last = i == stmts.len - 1;
            if (is_last and return_last and !isStmtForm(stmt)) {
                try self.writeIndent(w);
                try w.writeAll("return ");
                try self.emitExpr(stmt, w);
                try w.writeAll(";\n");
            } else {
                try self.emitStmt(stmt, w);
            }
        }
    }

    fn isStmtForm(sexp: Sexp) bool {
        if (sexp != .list) return false;
        const items = sexp.list;
        if (items.len == 0 or items[0] != .tag) return false;
        return switch (items[0].tag) {
            .@"=", .@"const", .@"return", .@"if", .@"while", .@"for", .@"for_ptr",
            .@"match", .@"break", .@"continue",
            .@"defer", .@"errdefer", .@"comptime", .@"inline", .@"zig", .@"labeled",
            .@"typed_assign", .@"typed_const",
            .@"+=", .@"-=", .@"*=", .@"/=" => true,
            else => false,
        };
    }

    // =========================================================================
    // Statements
    // =========================================================================

    fn emitStmt(self: *Compiler, sexp: Sexp, w: *Writer) Writer.Error!void {
        if (sexp != .list) {
            try self.writeIndent(w);
            try self.emitExpr(sexp, w);
            try w.writeAll(";\n");
            return;
        }
        const items = sexp.list;
        if (items.len == 0 or items[0] != .tag) return;

        switch (items[0].tag) {
            .@"if" => {
                try self.writeIndent(w);
                try self.emitIf(items[1..], w);
                try w.writeAll("\n");
            },
            .@"while" => {
                try self.writeIndent(w);
                try self.emitWhile(items[1..], w);
                try w.writeAll("\n");
            },
            .@"for" => {
                try self.writeIndent(w);
                try self.emitFor(items[1..], w);
                try w.writeAll("\n");
            },
            .@"for_ptr" => {
                try self.writeIndent(w);
                try self.emitForPtr(items[1..], w);
                try w.writeAll("\n");
            },
            .@"match" => {
                try self.writeIndent(w);
                try self.emitMatch(items[1..], w);
                try w.writeAll("\n");
            },
            .@"break" => {
                // (break [value] [to] [if])
                const has_cond = items.len > 3;
                const value = if (items.len > 1 and items[1] != .nil) items[1] else .nil;
                const label = if (items.len > 2 and items[2] != .nil) items[2] else .nil;
                try self.writeIndent(w);
                if (has_cond) {
                    try w.writeAll("if (");
                    try self.emitExpr(items[3], w);
                    try w.writeAll(") ");
                }
                try w.writeAll("break");
                if (label != .nil) {
                    try w.writeAll(" :");
                    try w.writeAll(self.txt(label));
                }
                if (value != .nil) {
                    try w.writeAll(" ");
                    try self.emitExpr(value, w);
                }
                try w.writeAll(";\n");
            },
            .@"continue" => {
                // (continue [to] [if])
                const label = if (items.len > 1 and items[1] != .nil) items[1] else .nil;
                const has_cond = items.len > 2 and items[2] != .nil;
                try self.writeIndent(w);
                if (has_cond) {
                    try w.writeAll("if (");
                    try self.emitExpr(items[2], w);
                    try w.writeAll(") ");
                }
                try w.writeAll("continue");
                if (label != .nil) {
                    try w.writeAll(" :");
                    try w.writeAll(self.txt(label));
                }
                try w.writeAll(";\n");
            },
            .@"labeled" => if (items.len >= 3) {
                try self.writeIndent(w);
                try w.writeAll(self.txt(items[1]));
                try w.writeAll(": ");
                const inner = items[2];
                if (inner == .list and inner.list.len > 0 and inner.list[0] == .tag) {
                    switch (inner.list[0].tag) {
                        .@"while" => try self.emitWhile(inner.list[1..], w),
                        .@"for" => try self.emitFor(inner.list[1..], w),
                        .@"for_ptr" => try self.emitForPtr(inner.list[1..], w),
                        .@"if" => try self.emitIf(inner.list[1..], w),
                        else => try self.emitBlockOrExpr(inner, w),
                    }
                } else {
                    try self.emitBlockOrExpr(inner, w);
                }
                try w.writeAll("\n");
            },
            .@"defer" => {
                try self.writeIndent(w);
                try w.writeAll("defer ");
                if (items.len > 1) try self.emitExpr(items[1], w);
                try w.writeAll(";\n");
            },
            .@"errdefer" => {
                try self.writeIndent(w);
                try w.writeAll("errdefer ");
                if (items.len > 1) try self.emitExpr(items[1], w);
                try w.writeAll(";\n");
            },
            .@"comptime" => {
                try self.writeIndent(w);
                try w.writeAll("comptime ");
                if (items.len > 1) try self.emitExpr(items[1], w);
                try w.writeAll(";\n");
            },
            .@"zig" => if (items.len > 1) {
                try self.writeIndent(w);
                const raw = self.source[items[1].src.pos..][0..items[1].src.len];
                if (raw.len >= 2) try w.writeAll(raw[1 .. raw.len - 1]);
                try w.writeAll("\n");
            },
            .@"inline" => {
                try self.writeIndent(w);
                // inline for → emit native Zig inline for (not while desugaring)
                if (items.len > 1 and items[1] == .list and items[1].list.len > 0 and
                    items[1].list[0] == .tag and items[1].list[0].tag == .@"for")
                {
                    const fc = items[1].list[1..];
                    if (fc.len >= 4) {
                        try w.writeAll("inline for (");
                        const collection = fc[2];
                        if (collection == .list and collection.list.len >= 3 and
                            collection.list[0] == .tag and collection.list[0].tag == .@"..")
                        {
                            try self.emitExpr(collection.list[1], w);
                            try w.writeAll("..");
                            try self.emitExpr(collection.list[2], w);
                        } else {
                            try self.emitExpr(collection, w);
                        }
                        try w.writeAll(") |");
                        try w.writeAll(self.txt(fc[0]));
                        try w.writeAll("| {\n");
                        self.depth += 1;
                        try self.emitBody(fc[3], false, w);
                        self.depth -= 1;
                        try self.writeIndent(w);
                        try w.writeAll("}\n");
                    }
                } else {
                    try w.writeAll("inline ");
                    if (items.len > 1) try self.emitStmt(items[1], w) else try w.writeAll(";\n");
                }
            },
            .@"=", .@"const" => {
                try self.writeIndent(w);
                try self.emitBinding(items[0].tag, items[1..], w);
                try w.writeAll(";\n");
            },
            .@"typed_assign", .@"typed_const" => {
                try self.writeIndent(w);
                try self.emitTypedBinding(items[0].tag, items[1..], w);
                try w.writeAll(";\n");
            },
            .@"+=", .@"-=", .@"*=" => {
                try self.writeIndent(w);
                try self.emitCompoundAssign(items[0].tag, items[1..], w);
                try w.writeAll(";\n");
            },
            .@"/=" => if (items.len >= 3) {
                try self.writeIndent(w);
                try self.emitExpr(items[1], w);
                try w.writeAll(" = @divTrunc(");
                try self.emitExpr(items[1], w);
                try w.writeAll(", ");
                try self.emitExpr(items[2], w);
                try w.writeAll(");\n");
            },
            .@"return" => {
                // (return [value] [if])
                const value = if (items.len > 1 and items[1] != .nil) items[1] else .nil;
                const has_cond = items.len > 2 and items[2] != .nil;
                try self.writeIndent(w);
                if (has_cond) {
                    try w.writeAll("if (");
                    try self.emitExpr(items[2], w);
                    try w.writeAll(") ");
                }
                try w.writeAll("return");
                if (value != .nil) {
                    try w.writeAll(" ");
                    try self.emitExpr(value, w);
                }
                try w.writeAll(";\n");
            },
            else => {
                try self.writeIndent(w);
                const is_call = items[0].tag == .@"call";
                const is_dot_call = items[0].tag == .@"." and items.len >= 3;
                if ((is_call and !self.isVoidCall(sexp)) or is_dot_call) try w.writeAll("_ = ");
                try self.emitExpr(sexp, w);
                try w.writeAll(";\n");
            },
        }
    }

    // =========================================================================
    // Expressions
    // =========================================================================

    fn emitExpr(self: *Compiler, sexp: Sexp, w: *Writer) Writer.Error!void {
        switch (sexp) {
            .src => |s| {
                const text = self.source[s.pos..][0..s.len];
                if (text.len >= 2 and text[0] == '\'') {
                    try w.writeByte('"');
                    try w.writeAll(text[1 .. text.len - 1]);
                    try w.writeByte('"');
                } else {
                    try w.writeAll(text);
                }
            },
            .str => |s| try w.writeAll(s),
            .nil => {},
            .tag => |t| try w.writeAll(@tagName(t)),
            .list => |items| {
                if (items.len == 0) return;
                if (items[0] != .tag) return;
                const tag = items[0].tag;
                const children = items[1..];
                switch (tag) {
                    .@"call" => try self.emitCall(children, w),

                    .@"." => if (children.len >= 2) {
                        try self.emitExpr(children[0], w);
                        try w.writeAll(".");
                        try w.writeAll(self.txt(children[1]));
                    },

                    .@"deref" => if (children.len >= 1) {
                        try self.emitExpr(children[0], w);
                        try w.writeAll(".*");
                    },

                    .@"index" => if (children.len >= 2) {
                        try self.emitExpr(children[0], w);
                        try w.writeAll("[");
                        try self.emitExpr(children[1], w);
                        try w.writeAll("]");
                    },

                    .@"array" => {
                        try w.writeAll("[_]i64{ ");
                        for (children, 0..) |elem, i| {
                            if (i > 0) try w.writeAll(", ");
                            try self.emitExpr(elem, w);
                        }
                        try w.writeAll(" }");
                    },

                    .@"try" => {
                        try w.writeAll("try ");
                        if (children.len > 0) try self.emitExpr(children[0], w);
                    },

                    .@"comptime" => {
                        try w.writeAll("comptime ");
                        if (children.len > 0) try self.emitExpr(children[0], w);
                    },
                    .@"inline" => {
                        try w.writeAll("inline ");
                        if (children.len > 0) try self.emitExpr(children[0], w);
                    },
                    .@"null" => try w.writeAll("null"),
                    .@"unreachable" => try w.writeAll("unreachable"),
                    .@"undefined" => try w.writeAll("undefined"),

                    .@"?", .@"ptr", .@"slice", .@"error_union" => {
                        try self.emitTyperef(sexp, w);
                    },

                    .@"record" => {
                        if (children.len > 0) try w.writeAll(self.txt(children[0]));
                        try w.writeAll("{ ");
                        for (children[1..], 0..) |p, i| {
                            if (i > 0) try w.writeAll(", ");
                            if (p == .list and p.list.len >= 3 and
                                p.list[0] == .tag and p.list[0].tag == .@"pair")
                            {
                                try w.writeAll(".");
                                try w.writeAll(self.txt(p.list[1]));
                                try w.writeAll(" = ");
                                try self.emitExpr(p.list[2], w);
                            }
                        }
                        try w.writeAll(" }");
                    },

                    .@"lambda" => {
                        // (lambda params returns:_ body)
                        try w.writeAll("struct { fn f(");
                        if (children.len >= 3 and children[0] != .nil) {
                            try self.emitParams(children[0], w);
                        }
                        try w.writeAll(") ");
                        if (children.len >= 3 and children[1] != .nil) {
                            try self.emitTyperef(children[1], w);
                        } else {
                            try w.writeAll("i64");
                        }
                        try w.writeAll(" { return ");
                        if (children.len >= 3) {
                            // body is a block — emit last expression
                            const body = children[2];
                            if (isBlock(body) and body.list.len >= 2) {
                                try self.emitExpr(body.list[body.list.len - 1], w);
                            }
                        } else if (children.len >= 1) {
                            const body = children[children.len - 1];
                            if (isBlock(body) and body.list.len >= 2) {
                                try self.emitExpr(body.list[body.list.len - 1], w);
                            }
                        }
                        try w.writeAll("; } }.f");
                    },

                    .@"builtin" => {
                        try w.writeAll("@");
                        if (children.len > 0) try w.writeAll(self.txt(children[0]));
                        try w.writeAll("(");
                        for (children[1..], 0..) |arg, i| {
                            if (i > 0) try w.writeAll(", ");
                            try self.emitExpr(arg, w);
                        }
                        try w.writeAll(")");
                    },

                    .@"??" => if (children.len >= 2) {
                        try self.emitExpr(children[0], w);
                        try w.writeAll(" orelse ");
                        try self.emitExpr(children[1], w);
                    },
                    .@"catch" => if (children.len >= 3) {
                        // (catch expr name handler) — with capture
                        try self.emitExpr(children[0], w);
                        try w.writeAll(" catch |");
                        try w.writeAll(self.txt(children[1]));
                        try w.writeAll("| ");
                        try self.emitExpr(children[2], w);
                    } else if (children.len >= 2) {
                        try self.emitExpr(children[0], w);
                        try w.writeAll(" catch ");
                        try self.emitExpr(children[1], w);
                    },

                    .@"if" => if (children.len >= 3) {
                        try w.writeAll("if (");
                        try self.emitExpr(children[0], w);
                        try w.writeAll(") ");
                        try self.emitExpr(children[1], w);
                        try w.writeAll(" else ");
                        try self.emitExpr(children[2], w);
                    },

                    .@"neg" => {
                        try w.writeAll("-");
                        if (children.len > 0) try self.emitExpr(children[0], w);
                    },
                    .@"not" => {
                        try w.writeAll("!");
                        if (children.len > 0) try self.emitExpr(children[0], w);
                    },
                    .@"addr_of" => {
                        try w.writeAll("&");
                        if (children.len > 0) try self.emitExpr(children[0], w);
                    },

                    .@"&&" => if (children.len >= 2) {
                        try self.emitGrouped(children[0], w);
                        try w.writeAll(" and ");
                        try self.emitGrouped(children[1], w);
                    },
                    .@"||" => if (children.len >= 2) {
                        try self.emitGrouped(children[0], w);
                        try w.writeAll(" or ");
                        try self.emitGrouped(children[1], w);
                    },

                    .@"|>" => if (children.len >= 2) {
                        try self.emitExpr(children[1], w);
                        try w.writeAll("(");
                        try self.emitExpr(children[0], w);
                        try w.writeAll(")");
                    },

                    .@".." => if (children.len >= 2) {
                        try self.emitExpr(children[0], w);
                        try w.writeAll("..");
                        try self.emitExpr(children[1], w);
                    },

                    .@"**" => {
                        try w.writeAll("std.math.pow(i64, ");
                        if (children.len >= 2) {
                            try self.emitExpr(children[0], w);
                            try w.writeAll(", ");
                            try self.emitExpr(children[1], w);
                        }
                        try w.writeAll(")");
                    },

                    .@"+", .@"-", .@"*", .@"/", .@"%",
                    .@"==", .@"!=", .@"<", .@">", .@"<=", .@">=",
                    => if (children.len >= 2) {
                        try self.emitGrouped(children[0], w);
                        try w.print(" {s} ", .{@tagName(tag)});
                        try self.emitGrouped(children[1], w);
                    },

                    else => try w.print("/* {s} */", .{@tagName(tag)}),
                }
            },
        }
    }

    fn isStringLit(self: *const Compiler, sexp: Sexp) bool {
        const t = self.txt(sexp);
        return t.len >= 2 and (t[0] == '\'' or t[0] == '"');
    }

    fn emitCall(self: *Compiler, children: []const Sexp, w: *Writer) Writer.Error!void {
        if (children.len == 0) return;
        const name = self.txt(children[0]);
        if (std.mem.eql(u8, name, "print")) {
            if (children.len > 1 and self.isStringLit(children[1])) {
                const raw = self.txt(children[1]);
                try w.writeAll("std.debug.print(\"");
                try w.writeAll(raw[1 .. raw.len - 1]);
                try w.writeAll("\\n\", .{})");
            } else if (children.len > 1) {
                try w.writeAll("std.debug.print(\"{any}\\n\", .{");
                try self.emitExpr(children[1], w);
                try w.writeAll("})");
            } else {
                try w.writeAll("std.debug.print(\"\\n\", .{})");
            }
            return;
        }
        try self.emitExpr(children[0], w);
        try w.writeAll("(");
        for (children[1..], 0..) |arg, i| {
            if (i > 0) try w.writeAll(", ");
            try self.emitExpr(arg, w);
        }
        try w.writeAll(")");
    }

    fn emitGrouped(self: *Compiler, sexp: Sexp, w: *Writer) Writer.Error!void {
        if (isBinOp(sexp)) {
            try w.writeAll("(");
            try self.emitExpr(sexp, w);
            try w.writeAll(")");
        } else {
            try self.emitExpr(sexp, w);
        }
    }

    fn isBinOp(sexp: Sexp) bool {
        if (sexp != .list) return false;
        const items = sexp.list;
        if (items.len == 0 or items[0] != .tag) return false;
        return switch (items[0].tag) {
            .@"+", .@"-", .@"*", .@"/", .@"%", .@"**",
            .@"==", .@"!=", .@"<", .@">", .@"<=", .@">=",
            .@"&&", .@"||" => true,
            else => false,
        };
    }

    // =========================================================================
    // Control flow
    // =========================================================================

    fn emitCaptureCond(self: *Compiler, cond: Sexp, w: *Writer) Writer.Error!void {
        if (cond == .list and cond.list.len >= 3 and
            cond.list[0] == .tag and cond.list[0].tag == .@"as")
        {
            try w.writeAll("(");
            try self.emitExpr(cond.list[1], w);
            try w.writeAll(") |");
            try w.writeAll(self.txt(cond.list[2]));
            try w.writeAll("|");
        } else {
            try w.writeAll("(");
            try self.emitExpr(cond, w);
            try w.writeAll(")");
        }
    }

    fn isBlock(sexp: Sexp) bool {
        return sexp == .list and sexp.list.len > 0 and
            sexp.list[0] == .tag and sexp.list[0].tag == .@"block";
    }

    fn emitBlockOrExpr(self: *Compiler, sexp: Sexp, w: *Writer) Writer.Error!void {
        try w.writeAll(" {\n");
        self.depth += 1;
        if (isBlock(sexp)) {
            try self.emitBody(sexp, false, w);
        } else {
            try self.writeIndent(w);
            try self.emitExpr(sexp, w);
            try w.writeAll(";\n");
        }
        self.depth -= 1;
        try self.writeIndent(w);
        try w.writeAll("}");
    }

    fn emitIf(self: *Compiler, children: []const Sexp, w: *Writer) Writer.Error!void {
        if (children.len < 2) return;

        try w.writeAll("if ");
        try self.emitCaptureCond(children[0], w);
        try self.emitBlockOrExpr(children[1], w);

        if (children.len >= 4) {
            // (if cond block capture_name else_block) — else with capture
            try w.writeAll(" else |");
            try w.writeAll(self.txt(children[2]));
            try w.writeAll("|");
            const else_clause = children[3];
            if (else_clause == .list and else_clause.list.len > 0 and
                else_clause.list[0] == .tag and else_clause.list[0].tag == .@"if")
            {
                try w.writeAll(" ");
                try self.emitIf(else_clause.list[1..], w);
            } else {
                try self.emitBlockOrExpr(else_clause, w);
            }
        } else if (children.len >= 3) {
            const else_clause = children[2];
            if (else_clause == .list and else_clause.list.len > 0 and
                else_clause.list[0] == .tag and else_clause.list[0].tag == .@"if")
            {
                try w.writeAll(" else ");
                try self.emitIf(else_clause.list[1..], w);
            } else {
                try w.writeAll(" else");
                try self.emitBlockOrExpr(else_clause, w);
            }
        }
    }

    fn emitWhile(self: *Compiler, children: []const Sexp, w: *Writer) Writer.Error!void {
        // (while cond update body) — update can be nil
        if (children.len < 3) return;

        try w.writeAll("while ");
        try self.emitCaptureCond(children[0], w);
        if (children[1] != .nil) {
            try w.writeAll(" : (");
            try self.emitExpr(children[1], w);
            try w.writeAll(")");
        }
        try w.writeAll(" {\n");

        self.depth += 1;
        try self.emitBody(children[2], false, w);
        self.depth -= 1;

        try self.writeIndent(w);
        try w.writeAll("}");
    }

    fn emitFor(self: *Compiler, children: []const Sexp, w: *Writer) Writer.Error!void {
        // (for name index? collection block) — index can be nil
        if (children.len < 4) return;
        const name = self.txt(children[0]);
        const collection = children[2];
        const body = children[3];

        // Check if collection is a range (.. start end)
        if (collection == .list and collection.list.len >= 3 and
            collection.list[0] == .tag and collection.list[0].tag == .@"..")
        {
            try w.writeAll("{\n");
            self.depth += 1;

            try self.writeIndent(w);
            try w.writeAll("var ");
            try w.writeAll(name);
            try w.writeAll(": i64 = ");
            try self.emitExpr(collection.list[1], w);
            try w.writeAll(";\n");

            try self.writeIndent(w);
            try w.writeAll("while (");
            try w.writeAll(name);
            try w.writeAll(" < ");
            try self.emitExpr(collection.list[2], w);
            try w.writeAll(") : (");
            try w.writeAll(name);
            try w.writeAll(" += 1) {\n");

            self.depth += 1;
            try self.emitBody(body, false, w);
            self.depth -= 1;

            try self.writeIndent(w);
            try w.writeAll("}\n");

            self.depth -= 1;
            try self.writeIndent(w);
            try w.writeAll("}");
        } else {
            try w.writeAll("for (");
            try self.emitExpr(collection, w);
            try w.writeAll(") |");
            try w.writeAll(name);
            if (children[1] != .nil) {
                try w.writeAll(", ");
                try w.writeAll(self.txt(children[1]));
            }
            try w.writeAll("| {\n");

            self.depth += 1;
            try self.emitBody(body, false, w);
            self.depth -= 1;

            try self.writeIndent(w);
            try w.writeAll("}");
        }
    }

    fn emitForPtr(self: *Compiler, children: []const Sexp, w: *Writer) Writer.Error!void {
        if (children.len < 4) return;
        const name = self.txt(children[0]);
        const collection = children[2];
        const body = children[3];

        try w.writeAll("for (");
        try self.emitExpr(collection, w);
        try w.writeAll(") |*");
        try w.writeAll(name);
        if (children[1] != .nil) {
            try w.writeAll(", ");
            try w.writeAll(self.txt(children[1]));
        }
        try w.writeAll("| {\n");

        self.depth += 1;
        try self.emitBody(body, false, w);
        self.depth -= 1;

        try self.writeIndent(w);
        try w.writeAll("}");
    }

    fn emitMatch(self: *Compiler, children: []const Sexp, w: *Writer) Writer.Error!void {
        if (children.len < 1) return;

        try w.writeAll("switch (");
        try self.emitExpr(children[0], w);
        try w.writeAll(") {\n");

        self.depth += 1;
        for (children[1..]) |arm_sexp| {
            if (arm_sexp != .list) continue;
            const arm = arm_sexp.list;
            if (arm.len < 4 or arm[0] != .tag) continue;
            // (arm pattern capture body) — capture can be nil
            const pat = arm[1];
            const capture = arm[2];
            const arm_body = arm[3];

            try self.writeIndent(w);
            try self.emitPattern(pat, w);

            try w.writeAll(" => ");
            if (capture != .nil) {
                try w.writeAll("|");
                try w.writeAll(self.txt(capture));
                try w.writeAll("| ");
            }

            if (isBlock(arm_body)) {
                try w.writeAll("{\n");
                self.depth += 1;
                try self.emitBody(arm_body, false, w);
                self.depth -= 1;
                try self.writeIndent(w);
                try w.writeAll("},\n");
            } else {
                if (arm_body == .list and arm_body.list.len > 0 and arm_body.list[0] == .tag and
                    arm_body.list[0].tag == .@"call" and
                    !self.isVoidCall(arm_body))
                    try w.writeAll("_ = ");
                try self.emitExpr(arm_body, w);
                try w.writeAll(",\n");
            }
        }
        self.depth -= 1;

        try self.writeIndent(w);
        try w.writeAll("}");
    }

    fn emitPattern(self: *Compiler, pat: Sexp, w: *Writer) Writer.Error!void {
        if (pat == .list and pat.list.len > 0 and pat.list[0] == .tag) {
            switch (pat.list[0].tag) {
                .@"range_pattern" => if (pat.list.len >= 3) {
                    try self.emitExpr(pat.list[1], w);
                    try w.writeAll("...");
                    try self.emitExpr(pat.list[2], w);
                },
                .@"enum_pattern" => if (pat.list.len >= 2) {
                    try w.writeAll(".");
                    try w.writeAll(self.txt(pat.list[1]));
                },
                else => try self.emitExpr(pat, w),
            }
        } else {
            const text = self.txt(pat);
            if (std.mem.eql(u8, text, "_")) {
                try w.writeAll("else");
            } else if (text.len > 0 and text[0] >= '0' and text[0] <= '9') {
                try w.writeAll(text);
            } else {
                try w.writeAll(".");
                try w.writeAll(text);
            }
        }
    }

    // =========================================================================
    // Bindings
    // =========================================================================

    fn emitBinding(self: *Compiler, tag: Tag, children: []const Sexp, w: *Writer) Writer.Error!void {
        if (children.len < 2) return;
        const name = self.txt(children[0]);
        const already = isEmitted(name);

        if (std.mem.eql(u8, name, "_")) {
            try w.writeAll("_");
        } else if (already) {
            try self.emitExpr(children[0], w);
        } else {
            markEmitted(name);
            if (tag == .@"const" or !self.isMutated(name)) {
                try w.writeAll("const ");
                try self.emitExpr(children[0], w);
            } else {
                try w.writeAll("var ");
                try self.emitExpr(children[0], w);
                if (self.typeOf(children[1])) |rhs_type| {
                    try w.writeAll(": ");
                    try self.emitTyperef(rhs_type, w);
                } else {
                    try w.writeAll(": i64");
                }
            }
        }
        try w.writeAll(" = ");
        try self.emitExpr(children[1], w);
    }

    fn emitCompoundAssign(self: *Compiler, tag: Tag, children: []const Sexp, w: *Writer) Writer.Error!void {
        if (children.len < 2) return;
        try self.emitExpr(children[0], w);
        try w.print(" {s} ", .{@tagName(tag)});
        try self.emitExpr(children[1], w);
    }

    fn emitTypedBinding(self: *Compiler, tag: Tag, children: []const Sexp, w: *Writer) Writer.Error!void {
        // (typed_assign name type expr) or (typed_const name type expr)
        if (children.len < 3) return;
        const name = self.txt(children[0]);
        const is_const = tag == .@"typed_const" or !self.isMutated(name);

        if (std.mem.eql(u8, name, "_")) {
            try w.writeAll("_");
        } else {
            markEmitted(name);
            if (is_const) {
                try w.writeAll("const ");
            } else {
                try w.writeAll("var ");
            }
            try self.emitExpr(children[0], w);
        }
        try w.writeAll(": ");
        try self.emitTyperef(children[1], w);
        try w.writeAll(" = ");
        try self.emitExpr(children[2], w);
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    fn txt(self: *const Compiler, sexp: Sexp) []const u8 {
        return sexp.getText(self.source);
    }

    fn writeIndent(self: *const Compiler, w: *Writer) Writer.Error!void {
        for (0..self.depth) |_| {
            try w.writeAll("    ");
        }
    }
};
