//! Rip Compiler — S-expression to Zig Source Emitter
//!
//! Walks the parsed S-expression tree and emits readable Zig source.
//! This is the v0 bootstrap emitter: fun params/returns default to i64,
//! sub returns default to void. Type resolution is a later pass.

const std = @import("std");
const parser = @import("parser.zig");
const rip = @import("rip.zig");

const Sexp = parser.Sexp;
const Tag = rip.Tag;
const Writer = std.Io.Writer;

const MAX_NAMES = 128;

pub const Compiler = struct {
    source: []const u8,
    depth: u32 = 0,

    // Scope tracking: names assigned more than once need `var`
    mutated: [MAX_NAMES][]const u8 = undefined,
    mut_count: usize = 0,
    bound: [MAX_NAMES][]const u8 = undefined,
    bound_count: usize = 0,

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
            .@"pub" => if (items.len > 1) {
                try w.writeAll("pub ");
                try self.emitTopLevel(items[1], w);
            },
            .@"error_set" => try self.emitErrorSet(items[1..], w),
            .@"test" => try self.emitTest(items[1..], w),
            .@"enum" => try self.emitEnum(items[1..], w),
            .@"struct" => try self.emitStruct(items[1..], w),
            .@"alias" => try self.emitAlias(items[1..], w),
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
        try w.print("const {s} = enum {{\n", .{name});
        self.depth += 1;
        for (children[1..]) |member| {
            try self.writeIndent(w);
            try w.writeAll(self.txt(member));
            try w.writeAll(",\n");
        }
        self.depth -= 1;
        try w.writeAll("};\n");
    }

    fn emitStruct(self: *Compiler, children: []const Sexp, w: *Writer) Writer.Error!void {
        if (children.len < 1) return;
        const name = self.txt(children[0]);
        try w.print("const {s} = struct {{\n", .{name});
        self.depth += 1;
        for (children[1..]) |item| {
            if (item == .list and item.list.len > 0 and item.list[0] == .tag) {
                const tag = item.list[0].tag;
                if (tag == .@":") {
                    try self.writeIndent(w);
                    try w.writeAll(self.txt(item.list[1]));
                    try w.writeAll(": ");
                    try self.emitTyperef(item.list[2], w);
                    try w.writeAll(",\n");
                    continue;
                }
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
            try self.writeIndent(w);
            try w.writeAll(self.txt(item));
            try w.writeAll(": i64,\n");
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

    fn emitAlias(self: *Compiler, children: []const Sexp, w: *Writer) Writer.Error!void {
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
            .@"=", .@"const", .@"return", .@"if", .@"while", .@"for",
            .@"match", .@"break", .@"continue", .@"defer", .@"errdefer", .@"comptime",
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
            .@"match" => {
                try self.writeIndent(w);
                try self.emitMatch(items[1..], w);
                try w.writeAll("\n");
            },
            .@"break" => {
                try self.writeIndent(w);
                try w.writeAll("break;\n");
            },
            .@"continue" => {
                try self.writeIndent(w);
                try w.writeAll("continue;\n");
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
            .@"=", .@"const" => {
                try self.writeIndent(w);
                try self.emitBinding(items[0].tag, items[1..], w);
                try w.writeAll(";\n");
            },
            .@"+=", .@"-=", .@"*=", .@"/=" => {
                try self.writeIndent(w);
                try self.emitCompoundAssign(items[0].tag, items[1..], w);
                try w.writeAll(";\n");
            },
            .@"return" => {
                try self.writeIndent(w);
                try self.emitReturn(items[1..], w);
                try w.writeAll(";\n");
            },
            else => {
                try self.writeIndent(w);
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
                    .@"call", .@"await" => try self.emitCall(children, w),

                    .@"." => if (children.len >= 2) {
                        try self.emitExpr(children[0], w);
                        try w.writeAll(".");
                        try w.writeAll(self.txt(children[1]));
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

                    .@"unreachable" => try w.writeAll("unreachable"),
                    .@"undefined" => try w.writeAll("undefined"),

                    .@"orelse" => if (children.len >= 2) {
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

                    .@"neg" => {
                        try w.writeAll("-");
                        if (children.len > 0) try self.emitExpr(children[0], w);
                    },
                    .@"not" => {
                        try w.writeAll("!");
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
                try w.writeAll("std.debug.print(\"{d}\\n\", .{");
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

    fn emitIf(self: *Compiler, children: []const Sexp, w: *Writer) Writer.Error!void {
        if (children.len < 2) return;

        try w.writeAll("if ");
        try self.emitCaptureCond(children[0], w);
        try w.writeAll(" {\n");

        self.depth += 1;
        try self.emitBody(children[1], false, w);
        self.depth -= 1;

        if (children.len >= 3) {
            const else_clause = children[2];
            if (else_clause == .list and else_clause.list.len > 0 and
                else_clause.list[0] == .tag and else_clause.list[0].tag == .@"if")
            {
                try self.writeIndent(w);
                try w.writeAll("} else ");
                try self.emitIf(else_clause.list[1..], w);
            } else {
                try self.writeIndent(w);
                try w.writeAll("} else {\n");
                self.depth += 1;
                try self.emitBody(else_clause, false, w);
                self.depth -= 1;
                try self.writeIndent(w);
                try w.writeAll("}");
            }
        } else {
            try self.writeIndent(w);
            try w.writeAll("}");
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

    fn emitMatch(self: *Compiler, children: []const Sexp, w: *Writer) Writer.Error!void {
        if (children.len < 1) return;

        try w.writeAll("switch (");
        try self.emitExpr(children[0], w);
        try w.writeAll(") {\n");

        self.depth += 1;
        for (children[1..]) |arm_sexp| {
            if (arm_sexp != .list) continue;
            const arm = arm_sexp.list;
            if (arm.len < 3 or arm[0] != .tag) continue;
            // (arm pattern expr)
            const pattern = self.txt(arm[1]);
            try self.writeIndent(w);
            if (std.mem.eql(u8, pattern, "_")) {
                try w.writeAll("else");
            } else if (pattern.len > 0 and (pattern[0] >= '0' and pattern[0] <= '9')) {
                try w.writeAll(pattern);
            } else {
                try w.writeAll(".");
                try w.writeAll(pattern);
            }
            const arm_body = arm[2];
            if (arm_body == .list and arm_body.list.len > 0 and
                arm_body.list[0] == .tag and arm_body.list[0].tag == .@"block")
            {
                try w.writeAll(" => {\n");
                self.depth += 1;
                try self.emitBody(arm_body, false, w);
                self.depth -= 1;
                try self.writeIndent(w);
                try w.writeAll("},\n");
            } else {
                try w.writeAll(" => ");
                try self.emitExpr(arm_body, w);
                try w.writeAll(",\n");
            }
        }
        self.depth -= 1;

        try self.writeIndent(w);
        try w.writeAll("}");
    }

    // =========================================================================
    // Bindings
    // =========================================================================

    fn emitBinding(self: *Compiler, tag: Tag, children: []const Sexp, w: *Writer) Writer.Error!void {
        if (children.len < 2) return;
        const name = self.txt(children[0]);
        const already = isEmitted(name);

        if (already) {
            try self.emitExpr(children[0], w);
        } else {
            markEmitted(name);
            if (tag == .@"const" or !self.isMutated(name)) {
                try w.writeAll("const ");
                try self.emitExpr(children[0], w);
            } else {
                try w.writeAll("var ");
                try self.emitExpr(children[0], w);
                try w.writeAll(": i64");
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

    fn emitReturn(self: *Compiler, children: []const Sexp, w: *Writer) Writer.Error!void {
        try w.writeAll("return");
        if (children.len > 0) {
            try w.writeAll(" ");
            try self.emitExpr(children[0], w);
        }
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
