#!/usr/bin/env node

/**
 * 上游词库（locals.js）的本地补丁注入器
 *
 * 背景：
 *   .github/workflows/sync-upstream.yml 每次运行都会用
 *   `git show <上游>:locals.js > locals.js` 直接覆盖本地词库，
 *   所以「缺词 / 错译」不能手改 locals.js —— 下次同步必丢。
 *   本脚本在同步之后、重建双语脚本之前运行，把 tools/locals-patch.json
 *   里的补丁以追加块的形式写进 locals.js 末尾。
 *
 * 用法：
 *   node tools/locals-patch.mjs                       # 就地打补丁（默认 tools/../locals.js）
 *   node tools/locals-patch.mjs --file /tmp/locals.js # 指定目标
 *   node tools/locals-patch.mjs --check               # 只校验是否已打补丁，未打则非 0 退出
 *   node tools/locals-patch.mjs --strip               # 去掉已有补丁块（还原上游原样）
 *
 * 幂等：以标记注释定位补丁块，重复运行只会保留一份。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATCH = path.join(TOOLS_DIR, 'locals-patch.json');
const DEFAULT_TARGET = path.join(TOOLS_DIR, '..', 'locals.js');

export const PATCH_BEGIN = '/* ==== bilingual 本地词库补丁';
export const PATCH_END = '/* ==== 本地词库补丁结束 ==== */';

/**
 * 正则规则的替换函数表。
 * 上游把处理逻辑写成函数时，词条 JSON 表达不了，只能在这里登记。
 */
const HANDLERS = {
    // "License and 9 other licenses found"
    licensesOther: function (all, lic, num) {
        if (lic === 'License') return '许可证（另有' + num + '个）';
        var named = { Unknown: '未知', Other: '其他' };
        return (named[lic] || lic) + '和另外' + num + '个许可证';
    },
};

function die(message) {
    console.error(`PATCH_ERROR=${message}`);
    process.exit(1);
}

function parseArgs(argv) {
    const result = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const item = argv[i];
        if (!item.startsWith('--')) continue;
        const key = item.slice(2);
        const next = argv[i + 1];
        if (!next || next.startsWith('--')) {
            result[key] = true;
        } else {
            result[key] = next;
            i++;
        }
    }
    return result;
}

function loadPatch(file) {
    if (!fs.existsSync(file)) die(`缺少补丁文件：${file}`);
    let patch;
    try {
        patch = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        die(`补丁文件不是合法 JSON：${error.message}`);
    }

    const merge = patch.staticMerge;
    if (!merge || typeof merge !== 'object') die('补丁文件缺少 staticMerge');

    for (const [page, dict] of Object.entries(merge)) {
        if (!dict || typeof dict !== 'object') die(`staticMerge.${page} 必须是对象`);
        for (const [key, value] of Object.entries(dict)) {
            if (typeof value !== 'string' || !value.trim()) {
                die(`staticMerge.${page}["${key}"] 必须是非空字符串`);
            }
        }
    }

    for (const fix of patch.regexpFix || []) {
        if (!fix.id || !fix.page || !fix.source) die('regexpFix 每项都必须有 id / page / source');
        if (!HANDLERS[fix.id]) die(`regexpFix 引用了未注册的处理函数：${fix.id}`);
    }

    return patch;
}

/** 生成补丁块；块内只用 ES5 语法，避免上游改构建目标后被语法卡住。 */
function buildPatchBlock(patch) {
    const lines = [];
    lines.push(`${PATCH_BEGIN}（由 tools/locals-patch.mjs 注入，手工修改会被覆盖） ==== */`);
    lines.push('(function () {');
    lines.push("    var zh = I18N['zh-CN'];");
    lines.push('    if (!zh) return;');
    lines.push('');
    lines.push('    function mergeStatic(page, dict) {');
    lines.push('        var target = zh[page];');
    lines.push('        if (!target || !target.static) return;');
    lines.push('        Object.keys(dict).forEach(function (key) { target.static[key] = dict[key]; });');
    lines.push('    }');

    for (const [page, dict] of Object.entries(patch.staticMerge)) {
        lines.push('');
        lines.push(`    mergeStatic(${JSON.stringify(page)}, ${JSON.stringify(dict, null, 4).replace(/\n/g, '\n    ')});`);
    }

    for (const fix of patch.regexpFix || []) {
        lines.push('');
        lines.push(`    // regexpFix: ${fix.id}`);
        lines.push(`    (function () {`);
        lines.push(`        var page = zh[${JSON.stringify(fix.page)}];`);
        lines.push('        if (!page || !page.regexp) return;');
        lines.push(`        var source = ${JSON.stringify(fix.source)};`);
        const handlerSource = HANDLERS[fix.id]
            .toString()
            .split('\n')
            .map((line, index) => (index === 0 ? line : `        ${line}`))
            .join('\n');
        lines.push(`        var handler = ${handlerSource};`);
        lines.push('        for (var i = 0; i < page.regexp.length; i++) {');
        lines.push('            if (page.regexp[i][0].source === source) { page.regexp[i][1] = handler; return; }');
        lines.push('        }');
        lines.push('        // 上游换了写法：退回追加到队首，保证新规则先匹配');
        lines.push('        page.regexp.unshift([new RegExp(source), handler]);');
        lines.push('    })();');
    }

    lines.push('})();');
    lines.push(PATCH_END);
    return lines.join('\n');
}

function stripPatch(text) {
    const start = text.indexOf(PATCH_BEGIN);
    if (start < 0) return text;

    const end = text.indexOf(PATCH_END, start);
    if (end < 0) die('找到补丁块开头却找不到结尾标记，文件可能被改坏');

    // 连同块前那一个换行一起删掉，保证反复 strip/apply 不涨空行
    const before = text.slice(0, start).replace(/\n+$/, '\n');
    const after = text.slice(end + PATCH_END.length).replace(/^\n+/, '');
    return before + after;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const patchFile = typeof args.patch === 'string' ? args.patch : DEFAULT_PATCH;
    const target = typeof args.file === 'string' ? args.file : DEFAULT_TARGET;

    const patch = loadPatch(patchFile);

    if (!fs.existsSync(target)) die(`目标文件不存在：${target}`);
    const raw = fs.readFileSync(target, 'utf8');
    // Windows 工作区是 CRLF、CI 是 LF：内部统一按 LF 处理，写回时还原原风格，
    // 否则本地会留下「前半 CRLF + 补丁块 LF」的混合换行。
    const usesCRLF = raw.includes('\r\n');
    const original = usesCRLF ? raw.replace(/\r\n/g, '\n') : raw;
    const writeOut = (file, text) => fs.writeFileSync(
        file,
        usesCRLF ? text.replace(/\n/g, '\r\n') : text,
        'utf8'
    );

    if (args.check) {
        if (!original.includes(PATCH_BEGIN)) {
            die(`目标文件未打补丁：${target}`);
        }
        console.log('PATCH_STATUS=applied');
        return;
    }

    const cleaned = stripPatch(original);

    if (args.strip) {
        writeOut(target, cleaned);
        console.log('PATCH_STATUS=stripped');
        return;
    }

    const block = buildPatchBlock(patch);
    const output = `${cleaned.replace(/\n*$/, '\n')}\n${block}\n`;

    // 原子写：先写临时文件再替换，避免 CI 中断留下半个词库
    const tmp = `${target}.patch-tmp`;
    writeOut(tmp, output);
    fs.renameSync(tmp, target);

    // 回读自检：标记存在，且每个词条都能在产物里找到
    const written = fs.readFileSync(target, 'utf8');
    if (!written.includes(PATCH_BEGIN) || !written.includes(PATCH_END)) {
        die('写回后找不到补丁块标记');
    }

    const missing = [];
    for (const [page, dict] of Object.entries(patch.staticMerge)) {
        for (const key of Object.keys(dict)) {
            if (!written.includes(JSON.stringify(key))) missing.push(`${page}.${key}`);
        }
    }
    if (missing.length) die(`写回后缺少词条：${missing.join(', ')}`);

    console.log(`PATCH_STATUS=applied 词条=${Object.values(patch.staticMerge).reduce((n, d) => n + Object.keys(d).length, 0)} 正则=${(patch.regexpFix || []).length}`);
}

main();
