/**
 * Shared Quiz Block Formatter for Universal Extraction and Obsidian Quiz Block Plugin
 * 
 * Supports:
 * - Pure, universal YAML, Python Dict, or JSON (clean, no markdown fence by default)
 * - Intelligent Obsidian ````qblock code fence wrapping with automatic backtick calculation
 *   (uses ```` or more when nested ``` code blocks are present, avoiding premature fence closure in Obsidian).
 * - Spec-compliant 6-space indentation for multiline YAML question block scalars, ensuring
 *   nested code blocks (e.g. ```java) are parsed accurately by YAML / Obsidian parser.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.QuizBlockFormatter = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  class QuizBlockFormatter {
    static LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];

    /**
     * Determines the proper markdown code fence (```` or more)
     * If the inner content contains backticks (e.g. nested ```java code block), CommonMark & Obsidian
     * require the outer fence to have more backticks than the inner code block.
     * Defaults to 4 backticks (````) as recommended by Quiz Block.
     */
    static getFence(content = "") {
      const matches = content.match(/`+/g);
      let maxBackticks = 0;
      if (matches) {
        for (const m of matches) {
          if (m.length > maxBackticks) maxBackticks = m.length;
        }
      }
      // If content contains 3 or more backticks, outer fence must be at least maxBackticks + 1
      const count = maxBackticks >= 3 ? Math.max(4, maxBackticks + 1) : 4;
      return "`".repeat(count);
    }

    /**
     * Safely format a multiline or single line string for YAML
     * Uses spec-compliant indentation for block scalar (|) lines
     */
    static escapeYaml(str, indent = 0) {
      if (typeof str !== 'string') return '""';
      const trimmed = str.trim();
      if (!trimmed) return '""';

      // Multiline strings (e.g. code blocks, multi-paragraph prompts)
      if (trimmed.includes('\n')) {
        const pad = ' '.repeat(indent);
        const lines = trimmed.split('\n').map(l => (l.trim().length === 0 ? '' : pad + l)).join('\n');
        return `|\n${lines}`;
      }

      // Check if YAML quoting is needed
      if (/[:#\-\[\]\{\},&*?|<>=!%@`'"]/.test(trimmed) || /^\d+$/.test(trimmed)) {
        return JSON.stringify(trimmed);
      }

      return trimmed;
    }

    /**
     * Format multiline or complex string for Python Dictionary
     * Uses triple double quotes """...""" for multiline / code snippets
     */
    static escapePythonString(str) {
      if (typeof str !== 'string') return '""';
      const trimmed = str.trim();
      if (trimmed.includes('\n') || trimmed.includes('"') || trimmed.includes("'")) {
        const safe = trimmed.replace(/"""/g, '\\"\\"\\"');
        return `"""${safe}"""`;
      }
      return JSON.stringify(trimmed);
    }

    /**
     * HTML entity decoder
     */
    static decodeEntities(str) {
      if (typeof str !== 'string') return '';
      return str
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
    }

    /**
     * Extracts and normalizes quiz data from varied inputs:
     * - Google NotebookLM raw object { quiz: [...], topics: {...} }
     * - HTML string containing data-app-data="..."
     * - DOM scraped data
     */
    static normalize(input) {
      if (!input) return null;

      let raw = input;

      // If string, try parsing as JSON or finding data-app-data attribute
      if (typeof input === 'string') {
        const trimmed = input.trim();
        const appDataMatch = trimmed.match(/data-app-data="([^"]+)"/);
        if (appDataMatch) {
          try {
            raw = JSON.parse(this.decodeEntities(appDataMatch[1]));
          } catch (e) {
            console.error("Failed to parse data-app-data JSON", e);
          }
        } else if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
          try {
            raw = JSON.parse(trimmed);
          } catch (e) {
            // ignore
          }
        }
      }

      const quizList = Array.isArray(raw) ? raw : (raw.quiz || raw.questions || []);
      const topics = raw.topics || {};

      let title = raw.title || "";
      if (!title && topics.covered && topics.covered.length > 0) {
        title = topics.covered[0];
      }
      if (!title) {
        title = "NotebookLM Quiz";
      }

      const normalizedQuestions = [];

      quizList.forEach((q, idx) => {
        const qText = (q.question || q.title || "").trim();
        if (!qText) return;

        const hint = (q.hint || "").trim();
        const explanation = (q.explanation || "").trim();
        const rawOptions = q.answerOptions || q.choices || q.options || [];
        const choices = [];
        const answer = [];

        rawOptions.forEach((opt, optIdx) => {
          const letter = QuizBlockFormatter.LETTERS[optIdx] || String(optIdx + 1);
          let text = "";
          let rationale = "";
          let isCorrect = false;

          if (typeof opt === 'string') {
            text = opt.trim();
          } else if (typeof opt === 'object' && opt !== null) {
            text = (opt.text || opt.choice || "").trim();
            rationale = (opt.rationale || opt.description || opt.desc || opt.explanation || "").trim();
            isCorrect = Boolean(opt.isCorrect || opt.correct);
          }

          if (isCorrect) {
            answer.push(letter);
          }

          choices.push({
            letter,
            text,
            description: rationale,
            isCorrect
          });
        });

        normalizedQuestions.push({
          id: `q_${idx + 1}`,
          question: qText,
          hint,
          explanation,
          type: answer.length > 1 ? "multiple" : "single",
          choices,
          answer
        });
      });

      return {
        title,
        topics,
        questions: normalizedQuestions
      };
    }

    /**
     * Render as Universal YAML (with optional adaptive ````qblock wrap)
     * Question block scalars use 6-space indent so nested ``` code blocks are parsed cleanly!
     */
    static toYaml(quiz, options = {}) {
      const { includeHints = true, includeRationales = true, shuffle = false, customTitle = "", wrapFence = false } = options;
      const normalized = this.normalize(quiz);
      if (!normalized || normalized.questions.length === 0) return "";

      const quizTitle = (customTitle && customTitle.trim()) ? customTitle.trim() : normalized.title;

      let body = `title: ${JSON.stringify(quizTitle)}\n`;
      if (shuffle) {
        body += `shuffle: true\n`;
      }
      body += `questions:\n`;

      normalized.questions.forEach((q) => {
        // Indent 6 spaces for multiline question scalar (deeper than 4-space question key)
        body += `  - question: ${this.escapeYaml(q.question, 6)}\n`;

        if (includeHints && q.hint) {
          body += `    hint: ${this.escapeYaml(q.hint, 6)}\n`;
        }

        if (q.explanation) {
          body += `    explanation: ${this.escapeYaml(q.explanation, 6)}\n`;
        }

        body += `    choices:\n`;
        q.choices.forEach((c) => {
          const hasDesc = includeRationales && c.description;
          if (hasDesc) {
            // Choice text & description block scalars indented at 10 spaces
            body += `      - text: ${this.escapeYaml(c.text, 10)}\n`;
            body += `        description: ${this.escapeYaml(c.description, 10)}\n`;
          } else {
            body += `      - ${this.escapeYaml(c.text, 8)}\n`;
          }
        });

        const ansFormatted = q.answer.length > 0 ? `[${q.answer.join(", ")}]` : "[]";
        body += `    answer: ${ansFormatted}\n\n`;
      });

      const cleanBody = body.trim();
      if (!wrapFence) {
        return cleanBody;
      }

      const fence = this.getFence(cleanBody);
      return `${fence}qblock\n${cleanBody}\n${fence}`;
    }

    /**
     * Render as Universal Python Dictionary (with optional adaptive ````qblock wrap)
     */
    static toPythonDict(quiz, options = {}) {
      const { includeHints = true, includeRationales = true, shuffle = false, customTitle = "", wrapFence = false } = options;
      const normalized = this.normalize(quiz);
      if (!normalized || normalized.questions.length === 0) return "";

      const quizTitle = (customTitle && customTitle.trim()) ? customTitle.trim() : normalized.title;

      let body = `{\n  'title': ${JSON.stringify(quizTitle)},\n`;
      if (shuffle) {
        body += `  'shuffle': True,\n`;
      }
      body += `  'questions': [\n`;

      normalized.questions.forEach((q, qIdx) => {
        body += `    {\n`;
        body += `      'question': ${this.escapePythonString(q.question)},\n`;
        if (includeHints && q.hint) {
          body += `      'hint': ${this.escapePythonString(q.hint)},\n`;
        }
        if (q.explanation) {
          body += `      'explanation': ${this.escapePythonString(q.explanation)},\n`;
        }

        body += `      'choices': [\n`;
        q.choices.forEach((c, cIdx) => {
          const hasDesc = includeRationales && c.description;
          if (hasDesc) {
            body += `        {\n`;
            body += `          'text': ${this.escapePythonString(c.text)},\n`;
            body += `          'description': ${this.escapePythonString(c.description)}\n`;
            body += `        }${cIdx < q.choices.length - 1 ? ',' : ''}\n`;
          } else {
            body += `        ${this.escapePythonString(c.text)}${cIdx < q.choices.length - 1 ? ',' : ''}\n`;
          }
        });
        body += `      ],\n`;

        const ansList = q.answer.map(a => `'${a}'`).join(', ');
        body += `      'answer': [${ansList}]\n`;
        body += `    }${qIdx < normalized.questions.length - 1 ? ',' : ''}\n`;
      });

      body += `  ]\n}`;

      if (!wrapFence) {
        return body;
      }

      const fence = this.getFence(body);
      return `${fence}qblock\n${body}\n${fence}`;
    }

    /**
     * Render as Universal JSON (with optional adaptive ````qblock wrap)
     */
    static toJson(quiz, options = {}) {
      const { includeHints = true, includeRationales = true, shuffle = false, customTitle = "", wrapFence = false } = options;
      const normalized = this.normalize(quiz);
      if (!normalized || normalized.questions.length === 0) return "";

      const quizTitle = (customTitle && customTitle.trim()) ? customTitle.trim() : normalized.title;

      const questions = normalized.questions.map(q => {
        const choices = q.choices.map(c => {
          if (includeRationales && c.description) {
            return { text: c.text, description: c.description };
          }
          return c.text;
        });

        const res = {
          question: q.question,
          choices,
          answer: q.answer
        };

        if (includeHints && q.hint) {
          res.hint = q.hint;
        }
        if (q.explanation) {
          res.explanation = q.explanation;
        }
        return res;
      });

      const root = {
        title: quizTitle,
        questions
      };
      if (shuffle) {
        root.shuffle = true;
      }

      const jsonStr = JSON.stringify(root, null, 2);
      if (!wrapFence) {
        return jsonStr;
      }

      const fence = this.getFence(jsonStr);
      return `${fence}qblock\n${jsonStr}\n${fence}`;
    }

    /**
     * Convenience wrapper
     */
    static format(quiz, formatType = 'py', options = {}) {
      switch (formatType) {
        case 'yaml':
          return this.toYaml(quiz, options);
        case 'json':
          return this.toJson(quiz, options);
        case 'py':
        default:
          return this.toPythonDict(quiz, options);
      }
    }
  }

  return QuizBlockFormatter;
});
