#!/usr/bin/env node

/**
 * GitHub 中文化 → 中英双语版自动重建器
 *
 * 用法：
 * node tools/rebuild-bilingual.mjs \
 *   --base /tmp/base-main.user.js \
 *   --upstream /tmp/new-main.user.js \
 *   --current /tmp/current-bilingual.user.js \
 *   --output main-bilingual.user.js
 *
 * 三方合并：
 *   base     = 上一次已同步的上游 main.user.js
 *   current  = 当前 main-bilingual.user.js
 *   upstream = 最新上游 main.user.js
 *
 * 元数据块不参与三方合并，而是从最新 upstream 自动重建。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const OWNER = 'xinxinenjoy';
const REPO = 'github-chinese';
const BRANCH = 'bilingual';

const RAW_BASE =
    `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}`;

const OVERRIDES = {
    name: 'GitHub 中英双语界面',
    namespace: `https://github.com/${OWNER}/${REPO}`,
    description: 'GitHub 系统 UI 中英双语对照显示，基于 maboloshi/github-chinese 修改。',
    author: '沙漠之子, WanXin',
    homepageURL: `https://github.com/${OWNER}/${REPO}`,
    supportURL: `https://github.com/${OWNER}/${REPO}/issues`,
    updateURL: `${RAW_BASE}/main-bilingual.user.js`,
    downloadURL: `${RAW_BASE}/main-bilingual.user.js`,
};

function die(message) {
    console.error(`BUILD_ERROR=${message}`);
    process.exit(1);
}

function parseArgs(argv) {
    const result = {};
    for (let i = 0; i < argv.length; i++) {
        const item = argv[i];
        if (!item.startsWith('--')) continue;
        const key = item.slice(2);
        const value = argv[i + 1];

        if (!value || value.startsWith('--')) {
            die(`参数 --${key} 缺少值`);
        }

        result[key] = value;
        i++;
    }
    return result;
}

function readText(file) {
    if (!fs.existsSync(file)) die(`文件不存在：${file}`);
    return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function splitUserscript(text, label) {
    const startMarker = '// ==UserScript==';
    const endMarker = '// ==/UserScript==';

    const start = text.indexOf(startMarker);
    const endStart = text.indexOf(endMarker, start);

    if (start < 0 || endStart < 0) {
        die(`${label} 找不到完整 UserScript 元数据块`);
    }

    const end = endStart + endMarker.length;

    return {
        meta: text.slice(start, end),
        body: text.slice(end).replace(/^\s*\n/, ''),
    };
}

function directiveValue(meta, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^//\\s+@${escaped}\\s+(.+?)\\s*$`, 'm');
    return meta.match(re)?.[1]?.trim() || '';
}

function upstreamCoreVersion(version) {
    const match = version.match(/^(\d+(?:\.\d+)+)/);
    if (!match) die(`无法识别上游版本号：${version}`);
    return match[1];
}

function currentBuildSerial(version) {
    const match = version.match(/-bilingual\.(\d+)$/);

    if (!match) {
        console.warn(
            `BUILD_WARNING=当前双语版本号 "${version}" 没有 bilingual.N，自动从 1 开始`
        );
        return 0;
    }

    return Number(match[1]);
}

function setUniqueDirective(lines, key, value) {
    const re = new RegExp(`^//\\s+@${key}\\s+`);
    let found = false;

    for (let i = 0; i < lines.length; i++) {
        if (!re.test(lines[i])) continue;

        if (!found) {
            lines[i] = `// @${key.padEnd(12)} ${value}`;
            found = true;
        } else {
            lines.splice(i, 1);
            i--;
        }
    }

    if (!found) {
        const end = lines.findIndex(
            line => line.trim() === '// ==/UserScript=='
        );

        if (end < 0) {
            die(`元数据缺少结束标记，无法插入 @${key}`);
        }

        lines.splice(
            end,
            0,
            `// @${key.padEnd(12)} ${value}`
        );
    }
}

function rebuildMetadata(upstreamMeta, currentMeta) {
    const upstreamVersion = directiveValue(upstreamMeta, 'version');
    const currentVersion = directiveValue(currentMeta, 'version');

    if (!upstreamVersion) die('最新上游缺少 @version');
    if (!currentVersion) die('当前双语版缺少 @version');

    const core = upstreamCoreVersion(upstreamVersion);
    const serial = currentBuildSerial(currentVersion) + 1;
    const newVersion = `${core}-bilingual.${serial}`;

    const lines = upstreamMeta.split('\n');

    setUniqueDirective(lines, 'name', OVERRIDES.name);
    setUniqueDirective(lines, 'namespace', OVERRIDES.namespace);
    setUniqueDirective(lines, 'description', OVERRIDES.description);
    setUniqueDirective(lines, 'version', newVersion);
    setUniqueDirective(lines, 'author', OVERRIDES.author);
    setUniqueDirective(lines, 'homepageURL', OVERRIDES.homepageURL);
    setUniqueDirective(lines, 'supportURL', OVERRIDES.supportURL);
    setUniqueDirective(lines, 'updateURL', OVERRIDES.updateURL);
    setUniqueDirective(lines, 'downloadURL', OVERRIDES.downloadURL);

    let localsRequireFound = false;

    for (let i = 0; i < lines.length; i++) {
        if (!/^\/\/\s+@require\s+/.test(lines[i])) continue;

        const url = lines[i]
            .replace(/^\/\/\s+@require\s+/, '')
            .trim();

        if (!/(?:^|\/)locals\.js(?:[?#].*)?$/.test(url)) continue;

        lines[i] =
            `// @require      ${RAW_BASE}/locals.js?v=${encodeURIComponent(newVersion)}`;

        localsRequireFound = true;
    }

    if (!localsRequireFound) {
        die(
            '最新上游未找到 locals.js 的 @require。上游加载方式可能已改变，为避免生成错误版本已停止。'
        );
    }

    return {
        meta: lines.join('\n'),
        newVersion,
        upstreamVersion,
    };
}

function runGitMergeFile(mode, currentFile, baseFile, upstreamFile) {
    const args = ['merge-file'];

    if (mode === 'ours') {
        args.push('--ours');
    }

    args.push(
        '-p',
        currentFile,
        baseFile,
        upstreamFile
    );

    return spawnSync(
        'git',
        args,
        { encoding: 'utf8' }
    );
}

function runMergeFile(currentBody, baseBody, upstreamBody) {
    const dir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'ghb-merge-')
    );

    const currentFile = path.join(dir, 'current.js');
    const baseFile = path.join(dir, 'base.js');
    const upstreamFile = path.join(dir, 'upstream.js');

    fs.writeFileSync(currentFile, currentBody, 'utf8');
    fs.writeFileSync(baseFile, baseBody, 'utf8');
    fs.writeFileSync(upstreamFile, upstreamBody, 'utf8');

    try {
        const clean = runGitMergeFile(
            'normal',
            currentFile,
            baseFile,
            upstreamFile
        );

        if (clean.status === 0) {
            return {
                body: clean.stdout,
                status: 'clean',
            };
        }

        if (clean.status !== 1) {
            die(
                `git merge-file 执行失败：${clean.stderr || `退出码 ${clean.status}`}`
            );
        }

        const ours = runGitMergeFile(
            'ours',
            currentFile,
            baseFile,
            upstreamFile
        );

        if (ours.status !== 0) {
            die(
                `冲突兜底合并失败：${ours.stderr || `退出码 ${ours.status}`}`
            );
        }

        return {
            body: ours.stdout,
            status: 'fallback-ours',
        };
    } finally {
        fs.rmSync(
            dir,
            { recursive: true, force: true }
        );
    }
}

function assertNoConflictMarkers(text) {
    for (const marker of ['<<<<<<<', '=======', '>>>>>>>']) {
        if (text.includes(marker)) {
            die(`生成文件仍包含 Git 冲突标记：${marker}`);
        }
    }
}

function assertStructure(text) {
    const bilingualMarkers = [
        'displayMode: GM_getValue("displayMode", "bilingual")',
        'function markBilingualLabel(',
        'function updateBilingualPageContext(',
        'ghb-bilingual-label',
        'BILINGUAL_UI_SELECTOR',
    ];

    const upstreamMarkers = [
        'function setupReactGlobalNavTranslation(',
        'function traverseNode(',
        'function transText(',
        'function setupMutationObserver(',
    ];

    for (const marker of [
        ...bilingualMarkers,
        ...upstreamMarkers
    ]) {
        if (!text.includes(marker)) {
            die(`结构检查失败，缺少关键标记：${marker}`);
        }
    }
}

function syntaxCheck(file) {
    const result = spawnSync(
        process.execPath,
        ['--check', file],
        { encoding: 'utf8' }
    );

    if (result.status !== 0) {
        die(`Node 语法检查失败：\n${result.stderr}`);
    }
}

const args = parseArgs(process.argv.slice(2));

for (const required of [
    'base',
    'upstream',
    'current',
    'output'
]) {
    if (!args[required]) {
        die(`缺少必要参数 --${required}`);
    }
}

const base = splitUserscript(
    readText(args.base),
    '旧上游 main.user.js'
);

const upstream = splitUserscript(
    readText(args.upstream),
    '新上游 main.user.js'
);

const current = splitUserscript(
    readText(args.current),
    '当前 main-bilingual.user.js'
);

const merged = runMergeFile(
    current.body,
    base.body,
    upstream.body
);

const metadata = rebuildMetadata(
    upstream.meta,
    current.meta
);

let output =
    `${metadata.meta}\n\n${merged.body.replace(/^\s+/, '')}`;

if (!output.endsWith('\n')) {
    output += '\n';
}

assertNoConflictMarkers(output);
assertStructure(output);

fs.writeFileSync(
    args.output,
    output,
    'utf8'
);

syntaxCheck(args.output);

console.log(`BUILD_STATUS=${merged.status}`);
console.log(`UPSTREAM_VERSION=${metadata.upstreamVersion}`);
console.log(`NEW_VERSION=${metadata.newVersion}`);

if (merged.status === 'fallback-ours') {
    console.warn(
        'BUILD_WARNING=上游与双语修改发生重叠，已自动保留双语冲突区并吸收其他上游更新。'
    );
}
