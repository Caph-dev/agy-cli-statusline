/**
 * Text template renderer: `{field}` interpolates a value, `[...]` is an
 * optional group omitted when any direct field inside is missing, and `\`
 * escapes the next character as a literal.
 */

import { sanitizeText } from "./ansi.mjs";

export function parseTemplate(template) {
  const source = String(template ?? "");
  let index = 0;

  function parseNodes(inGroup) {
    const nodes = [];
    let literal = "";
    const flush = () => {
      if (literal) {
        nodes.push({ type: "lit", text: literal });
        literal = "";
      }
    };
    while (index < source.length) {
      const char = source[index];
      index += 1;
      if (char === "\\") {
        if (index < source.length) {
          literal += source[index];
          index += 1;
        }
      } else if (char === "{") {
        const close = source.indexOf("}", index);
        if (close === -1) {
          literal += "{";
        } else {
          flush();
          const name = source.slice(index, close).trim();
          index = close + 1;
          if (name) nodes.push({ type: "field", name });
        }
      } else if (char === "[") {
        flush();
        nodes.push({ type: "group", children: parseNodes(true) });
      } else if (char === "]" && inGroup) {
        break;
      } else {
        literal += char;
      }
    }
    flush();
    return nodes;
  }

  return parseNodes(false);
}

function hasField(fields, name) {
  if (!fields || !Object.hasOwn(fields, name)) return false;
  const value = fields[name];
  return value != null && value !== "";
}

function evaluateNodes(nodes, fields, isGroup) {
  let hasDirectField = false;
  let hasChildGroup = false;
  let renderedChildGroup = false;
  let out = "";

  for (const node of nodes) {
    if (node.type === "field") {
      hasDirectField = true;
      if (!hasField(fields, node.name)) return { ok: false, text: "" };
    }
  }

  for (const node of nodes) {
    if (node.type === "lit") {
      out += node.text;
    } else if (node.type === "field") {
      out += sanitizeText(String(fields[node.name]));
    } else if (node.type === "group") {
      hasChildGroup = true;
      const inner = evaluateNodes(node.children, fields, true);
      if (inner.ok && inner.text) {
        renderedChildGroup = true;
        out += inner.text;
      }
    }
  }

  if (isGroup && !hasDirectField && hasChildGroup && !renderedChildGroup) {
    return { ok: false, text: "" };
  }
  return { ok: true, text: out };
}

export function renderTemplate(template, fields) {
  const nodes = parseTemplate(template);
  const result = evaluateNodes(nodes, fields, false);
  if (!result.ok || !result.text.trim()) return "";
  return sanitizeText(result.text);
}

export function templateUsesField(template, names) {
  const wanted = new Set(names);
  const walk = (nodes) => nodes.some((node) => (
    (node.type === "field" && wanted.has(node.name))
    || (node.type === "group" && walk(node.children))
  ));
  return walk(parseTemplate(template));
}
