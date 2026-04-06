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

pub const Compiler = struct {
    source: []const u8,
    depth: u32 = 0,

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
        if (items[0].tag != .module) return;
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
            .fun => try self.emitFun(items[1..], w),
            .sub => try self.emitSub(items[1..], w),
            .use => try self.emitUse(items[1..], w),
            else => try self.emitStmt(sexp, w),
        }
    }

    // =========================================================================
    // Declarations
    // =========================================================================

    fn emitFun(self: *Compiler, children: []const Sexp, w: *Writer) Writer.Error!void {
        if (children.len < 2) return;
        const name = self.txt(children[0]);
        const has_params = children.len >= 3;

        try w.writeAll("fn ");
        try w.writeAll(name);
        try w.writeAll("(");
        if (has_params) try self.emitParams(children[1], w);
        try w.writeAll(") i64 {\n");

        self.depth += 1;
        try self.emitBody(children[if (has_params) 2 else 1], true, w);
        self.depth -= 1;
        try w.writeAll("}\n");
    }

    fn emitSub(self: *Compiler, children: []const Sexp, w: *Writer) Writer.Error!void {
        if (children.len < 2) return;
        const name = self.txt(children[0]);
        const is_main = std.mem.eql(u8, name, "main");
        const has_params = children.len >= 3;

        if (is_main) try w.writeAll("pub ");
        try w.writeAll("fn ");
        try w.writeAll(name);
        try w.writeAll("(");
        if (has_params) try self.emitParams(children[1], w);
        try w.writeAll(") void {\n");

        self.depth += 1;
        try self.emitBody(children[if (has_params) 2 else 1], false, w);
        self.depth -= 1;
        try w.writeAll("}\n");
    }

    fn emitParams(self: *Compiler, sexp: Sexp, w: *Writer) Writer.Error!void {
        if (sexp != .list) return;
        for (sexp.list, 0..) |param, i| {
            if (i > 0) try w.writeAll(", ");
            try w.writeAll(self.txt(param));
            try w.writeAll(": i64");
        }
    }

    fn emitUse(self: *Compiler, children: []const Sexp, w: *Writer) Writer.Error!void {
        if (children.len == 0) return;
        const name = self.txt(children[0]);
        try w.print("const {s} = @import(\"{s}\");\n", .{ name, name });
    }

    // =========================================================================
    // Block body
    // =========================================================================

    fn emitBody(self: *Compiler, sexp: Sexp, return_last: bool, w: *Writer) Writer.Error!void {
        if (sexp != .list) return;
        const items = sexp.list;
        if (items.len == 0 or items[0] != .tag) return;
        if (items[0].tag != .block) return;

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
            .@"=", .@"const", .@"return", .@"if" => true,
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
            .@"=", .@"const" => {
                try self.writeIndent(w);
                try self.emitBinding(items[1..], w);
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
            .src => |s| try w.writeAll(self.source[s.pos..][0..s.len]),
            .str => |s| try w.writeAll(s),
            .nil => {},
            .tag => |t| try w.writeAll(@tagName(t)),
            .list => |items| {
                if (items.len == 0) return;
                if (items[0] != .tag) return;
                const tag = items[0].tag;
                const children = items[1..];
                switch (tag) {
                    .call, .@"await" => try self.emitCall(children, w),

                    .neg => {
                        try w.writeAll("-");
                        if (children.len > 0) try self.emitExpr(children[0], w);
                    },
                    .not => {
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

    fn emitCall(self: *Compiler, children: []const Sexp, w: *Writer) Writer.Error!void {
        if (children.len == 0) return;
        const name = self.txt(children[0]);
        if (std.mem.eql(u8, name, "print")) {
            try w.writeAll("std.debug.print(\"{d}\\n\", .{");
            if (children.len > 1) try self.emitExpr(children[1], w);
            try w.writeAll("})");
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

    fn emitIf(self: *Compiler, children: []const Sexp, w: *Writer) Writer.Error!void {
        if (children.len < 2) return;

        try w.writeAll("if (");
        try self.emitExpr(children[0], w);
        try w.writeAll(") {\n");

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

    // =========================================================================
    // Bindings
    // =========================================================================

    fn emitBinding(self: *Compiler, children: []const Sexp, w: *Writer) Writer.Error!void {
        if (children.len < 2) return;
        try w.writeAll("const ");
        try self.emitExpr(children[0], w);
        try w.writeAll(" = ");
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
