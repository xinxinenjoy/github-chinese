/**
 * 双语脚本「显示覆盖」规则的加载与应用。
 *
 * tools/bilingual-coverage.json 是唯一真相源；
 * tools/rebuild-bilingual.mjs 每次重建时调用本模块，把规则写进产出的
 * main-bilingual.user.js ⇒ 调整覆盖范围只改规则文件，不用碰产物脚本。
 *
 * 抽成独立模块是为了能被单独测试（不依赖 git merge-file）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));

export const COVERAGE_FILE = path.join(TOOLS_DIR, 'bilingual-coverage.json');

/** 产物脚本里的常量名 → 规则文件里的字段名 */
export const COVERAGE_CONSTANTS = {
    BILINGUAL_UI_SELECTOR: 'uiSelectors',
    BILINGUAL_EXCLUDE_SELECTOR: 'excludeSelectors',
};

export function loadCoverageRules(file = COVERAGE_FILE) {
    if (!fs.existsSync(file)) {
        throw new Error(`缺少覆盖规则文件：${file}`);
    }

    let rules;

    try {
        rules = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        throw new Error(`覆盖规则文件不是合法 JSON：${error.message}`);
    }

    for (const key of Object.keys(COVERAGE_CONSTANTS).map(k => COVERAGE_CONSTANTS[k])) {
        if (!Array.isArray(rules[key]) || rules[key].length === 0) {
            throw new Error(`覆盖规则 ${key} 必须是非空数组`);
        }

        for (const item of rules[key]) {
            if (typeof item !== 'string' || !item.trim()) {
                throw new Error(`覆盖规则 ${key} 含非法条目：${JSON.stringify(item)}`);
            }
        }
    }

    return rules;
}

/**
 * 匹配脚本里的 `const XXX = [ ... ].join(', ');`
 * 第 1 组 = 常量行的缩进，第 2 组 = 数组元素区。
 */
export function coverageArrayPattern(constName) {
    return new RegExp(
        `^([ \\t]*)const ${constName} = \\[[^\\n]*\\n([\\s\\S]*?)\\n[ \\t]*\\]\\.join\\(', '\\);`,
        'm'
    );
}

/**
 * 用规则文件重写产物里的两个载体常量。
 * 保留脚本原有缩进风格，避免产生无意义的格式 diff。
 */
export function injectCoverageRules(text, rules, nl = '\n') {
    let output = text;

    for (const [constName, ruleKey] of Object.entries(COVERAGE_CONSTANTS)) {
        const pattern = coverageArrayPattern(constName);

        if (!pattern.test(output)) {
            throw new Error(`产物中找不到 ${constName}，无法注入覆盖规则`);
        }

        output = output.replace(pattern, (match, indent) => {
            const itemIndent = `${indent}    `;
            const items = rules[ruleKey]
                .map(item => `${itemIndent}'${String(item).replace(/'/g, "\\'")}'`)
                .join(`,${nl}`);

            return `${indent}const ${constName} = [${nl}${items}${nl}${indent}].join(', ');`;
        });
    }

    return output;
}

/**
 * 注入后回读产物，确认与规则逐条一致。
 * 防止正则失配导致「静默没注入」——那种情况下产物会继续沿用旧规则。
 */
export function assertCoverageMatches(text, rules) {
    for (const [constName, ruleKey] of Object.entries(COVERAGE_CONSTANTS)) {
        const match = text.match(coverageArrayPattern(constName));

        if (!match) {
            throw new Error(`覆盖规则自检失败：产物里读不到 ${constName}`);
        }

        const actual = match[2]
            .split('\n')
            .map(line => line.trim().replace(/,$/, ''))
            .filter(Boolean)
            .map(line => line.replace(/^'/, '').replace(/'$/, '').replace(/\\'/g, "'"));

        const expected = rules[ruleKey];

        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            throw new Error(
                `覆盖规则自检失败：${constName} 与 ${ruleKey} 不一致\n` +
                `期望 ${expected.length} 条 / 实际 ${actual.length} 条`
            );
        }
    }
}
