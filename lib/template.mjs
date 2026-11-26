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

function evaluateParts(nodes, fields, fieldRoles, isGroup) {
  let hasDirectField = false;
  let hasChildGroup = false;
  let renderedChildGroup = false;
  const parts = [];

  for (const node of nodes) {
    if (node.type === "field") {
      hasDirectField = true;
      if (!hasField(fields, node.name)) return { ok: false, parts: [] };
    }
  }

  for (const node of nodes) {
    if (node.type === "lit") {
      parts.push({ text: node.text, role: "text" });
    } else if (node.type === "field") {
      const role = fieldRoles && Object.hasOwn(fieldRoles, node.name) ? fieldRoles[node.name] : "text";
      parts.push({ text: sanitizeText(String(fields[node.name])), role: role || "text" });
    } else if (node.type === "group") {
      hasChildGroup = true;
      const inner = evaluateParts(node.children, fields, fieldRoles, true);
      if (inner.ok && inner.parts.length > 0) {
        renderedChildGroup = true;
        parts.push(...inner.parts);
      }
    }
  }

  if (isGroup && !hasDirectField && hasChildGroup && !renderedChildGroup) {
    return { ok: false, parts: [] };
  }
  return { ok: true, parts };
}

function mergeParts(parts) {
  const merged = [];
  for (const part of parts) {
    const text = sanitizeText(part.text);
    if (!text) continue;
    const role = part.role || "text";
    const last = merged.at(-1);
    if (last && last.role === role) last.text += text;
    else merged.push({ text, role });
  }
  return merged;
}

export function renderTemplateParts(template, fields, fieldRoles = null) {
  const nodes = parseTemplate(template);
  const result = evaluateParts(nodes, fields, fieldRoles, false);
  if (!result.ok) return [];
  const merged = mergeParts(result.parts);
  if (!merged.some((part) => part.text.trim())) return [];
  return merged;
}

export function renderTemplate(template, fields) {
  return renderTemplateParts(template, fields).map((part) => part.text).join("");
}

export function templateUsesField(template, names) {
  const wanted = new Set(names);
  const walk = (nodes) => nodes.some((node) => (
    (node.type === "field" && wanted.has(node.name))
    || (node.type === "group" && walk(node.children))
  ));
  return walk(parseTemplate(template));
}
