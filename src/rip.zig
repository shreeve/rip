//! Rip Language Module
//!
//! Provides keyword lookup and tag definitions for the Rip language.
//! Imported by the generated parser via @lang = "rip".

const std = @import("std");
const parser = @import("parser.zig");
const BaseLexer = parser.BaseLexer;
const Token = parser.Token;
const TokenCat = parser.TokenCat;

// =============================================================================
// Tag Enum — semantic node types for S-expression output
// =============================================================================

pub const Tag = enum(u8) {
    // Module structure
    module,
    use,

    // Routines
    fun,
    sub,
    param,
    @"return",

    // Bindings
    assign, // =
    @"const", // =!
    @"=", // raw assign sexp head
    @"[]", // empty param list marker

    // Control flow
    @"if",
    @"else",

    // Calls
    call,
    @"await",

    // Operators — arithmetic
    @"+",
    @"-",
    @"*",
    @"/",
    @"%",
    @"**",
    neg, // unary -
    not, // unary !

    // Operators — comparison
    eq,
    ne,
    lt,
    gt,
    le,
    ge,
    @"==",
    @"!=",
    @"<",
    @">",
    @"<=",
    @">=",

    // Operators — logical
    @"and",
    @"or",
    @"||",
    @"&&",

    // Structure
    block,
    expr, // expression statement wrapper

    _,
};

// =============================================================================
// Keyword Lookup — maps identifier text to parser symbol IDs
// =============================================================================

pub const keyword_id = enum(u16) {
    FUN,
    SUB,
    USE,
    IF,
    ELSE,
    RETURN,
    TRUE,
    FALSE,
    AND,
    OR,
    NOT,
    COMMENT,
    NEWLINE,
    IDENT,
    INTEGER,
    REAL,
    STRING_SQ,
    STRING_DQ,
    INDENT,
    OUTDENT,
};

const keyword_map = std.StaticStringMap(keyword_id).initComptime(.{
    .{ "fun", .FUN },
    .{ "sub", .SUB },
    .{ "use", .USE },
    .{ "if", .IF },
    .{ "else", .ELSE },
    .{ "return", .RETURN },
    .{ "true", .TRUE },
    .{ "false", .FALSE },
    .{ "and", .AND },
    .{ "or", .OR },
    .{ "not", .NOT },
});

pub fn keyword_as(name: []const u8) ?keyword_id {
    return keyword_map.get(name);
}

// =============================================================================
// Lexer — indentation-tracking wrapper around generated BaseLexer
// =============================================================================

pub const Lexer = struct {
    base: BaseLexer,
    indent_level: u32 = 0,
    indent_stack: [64]u32 = .{0} ** 64,
    indent_depth: u8 = 0,
    indent_pending: u8 = 0,
    indent_queued: ?Token = null,
    indent_trailing_newline: bool = false,
    last_cat: TokenCat = .eof,

    pub fn init(source: []const u8) Lexer {
        return .{ .base = BaseLexer.init(source) };
    }

    pub fn text(self: *const Lexer, tok: Token) []const u8 {
        return self.base.text(tok);
    }

    pub fn reset(self: *Lexer) void {
        self.base.reset();
        self.indent_level = 0;
        self.indent_depth = 0;
        self.indent_pending = 0;
        self.indent_queued = null;
        self.indent_trailing_newline = false;
        self.last_cat = .eof;
    }

    pub fn next(self: *Lexer) Token {
        if (self.indent_queued) |q| {
            self.indent_queued = null;
            self.last_cat = q.cat;
            return q;
        }
        if (self.indent_pending > 0) {
            self.indent_pending -= 1;
            if (self.indent_pending == 0 and self.indent_trailing_newline) {
                self.indent_trailing_newline = false;
                self.indent_queued = Token{ .cat = .newline, .pre = 0, .pos = @intCast(self.base.pos), .len = 0 };
            }
            self.last_cat = .outdent;
            return Token{ .cat = .outdent, .pre = 0, .pos = @intCast(self.base.pos), .len = 0 };
        }

        while (true) {
            const tok = self.base.matchRules();

            // Skip comment tokens
            if (tok.cat == .comment) continue;

            // Strip type annotations: `: type` after identifiers
            if (tok.cat == .colon and (self.last_cat == .ident or self.last_cat == .rparen)) {
                const peek = self.base.matchRules();
                if (peek.cat == .ident) {
                    continue;
                }
                // Not a type annotation — we consumed one token too many.
                // Put the peeked token in the queue and return the colon.
                // For now, just skip both (colon without type is unusual in v0).
                continue;
            }

            // Strip return type annotations: `-> type` after param lists
            if (tok.cat == .arrow and (self.last_cat == .ident or self.last_cat == .rparen)) {
                const peek = self.base.matchRules();
                if (peek.cat == .ident) {
                    continue;
                }
                continue;
            }

            // Skip duplicate newlines
            if (tok.cat == .newline and (self.last_cat == .newline or self.last_cat == .indent or self.last_cat == .outdent or self.last_cat == .eof)) {
                continue;
            }

            if (tok.cat == .newline) {
                const result = self.handleIndent(tok);
                self.last_cat = result.cat;
                return result;
            }

            if (tok.cat == .eof) {
                if (self.indent_depth > 0) {
                    self.indent_depth -= 1;
                    if (self.indent_depth > 0) {
                        self.indent_pending = self.indent_depth;
                        self.indent_depth = 0;
                    }
                    self.indent_level = 0;
                    self.indent_trailing_newline = false;
                    self.last_cat = .outdent;
                    return Token{ .cat = .outdent, .pre = 0, .pos = @intCast(self.base.pos), .len = 0 };
                }
                self.last_cat = .eof;
                return tok;
            }

            self.last_cat = tok.cat;
            return tok;
        }
    }

    fn handleIndent(self: *Lexer, nl_tok: Token) Token {
        if (self.base.paren > 0 or self.base.brace > 0) return nl_tok;

        var ws: u32 = 0;
        while (self.base.pos + ws < self.base.source.len) {
            const ch = self.base.source[self.base.pos + ws];
            if (ch == ' ' or ch == '\t') {
                ws += 1;
            } else break;
        }
        if (self.base.pos + ws >= self.base.source.len or
            self.base.source[self.base.pos + ws] == '\n' or
            self.base.source[self.base.pos + ws] == '\r' or
            self.base.source[self.base.pos + ws] == '#')
        {
            return nl_tok;
        }

        if (ws > self.indent_level) {
            if (self.indent_depth >= 63)
                return Token{ .cat = .err, .pre = 0, .pos = @intCast(self.base.pos), .len = 0 };
            self.indent_stack[self.indent_depth] = self.indent_level;
            self.indent_depth += 1;
            self.indent_level = ws;
            return Token{ .cat = .indent, .pre = 0, .pos = @intCast(self.base.pos), .len = 0 };
        } else if (ws < self.indent_level) {
            var count: u8 = 0;
            var next_level = self.indent_level;
            while (next_level > ws) {
                if (self.indent_depth == 0)
                    return Token{ .cat = .err, .pre = 0, .pos = @intCast(self.base.pos), .len = 0 };
                self.indent_depth -= 1;
                next_level = self.indent_stack[self.indent_depth];
                count += 1;
            }
            if (next_level != ws)
                return Token{ .cat = .err, .pre = 0, .pos = @intCast(self.base.pos), .len = 0 };
            self.indent_level = ws;
            if (count > 0) {
                if (count > 1) {
                    self.indent_pending = count - 1;
                    self.indent_trailing_newline = !self.nextTokenIsElse();
                }
                return Token{ .cat = .outdent, .pre = 0, .pos = @intCast(self.base.pos), .len = 0 };
            }
            return nl_tok;
        }
        return nl_tok;
    }

    fn nextTokenIsElse(self: *const Lexer) bool {
        var probe = self.base;
        const tok = probe.matchRules();
        return tok.cat == .ident and std.mem.eql(u8, self.base.source[tok.pos..][0..tok.len], "else");
    }
};

// =============================================================================
// Tests
// =============================================================================

test "keyword_as - core keywords" {
    try std.testing.expectEqual(keyword_id.FUN, keyword_as("fun").?);
    try std.testing.expectEqual(keyword_id.SUB, keyword_as("sub").?);
    try std.testing.expectEqual(keyword_id.USE, keyword_as("use").?);
    try std.testing.expectEqual(keyword_id.IF, keyword_as("if").?);
    try std.testing.expectEqual(keyword_id.ELSE, keyword_as("else").?);
    try std.testing.expectEqual(keyword_id.RETURN, keyword_as("return").?);
    try std.testing.expectEqual(keyword_id.TRUE, keyword_as("true").?);
    try std.testing.expectEqual(keyword_id.FALSE, keyword_as("false").?);
}

test "keyword_as - not a keyword" {
    try std.testing.expect(keyword_as("total") == null);
    try std.testing.expect(keyword_as("add") == null);
    try std.testing.expect(keyword_as("exists?") == null);
    try std.testing.expect(keyword_as("") == null);
}
