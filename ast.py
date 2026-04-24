"""
QA Code Audit Script - FollowupGantt
=====================================
Analiza archivos TypeScript/TSX del proyecto buscando:
1. Funciones/componentes vacíos o placeholder (sin lógica real)
2. Comentarios TODO/FIXME/TBD pendientes
3. Uso de `any` type (debt técnico)
4. Console.log residuales
5. Imports no utilizados (heurístico)
6. Funciones sin tipado explícito de retorno
7. Código muerto / placeholder text
"""

import os
import re
import json
from datetime import datetime

PROJECT_SRC = os.path.join(os.path.dirname(__file__), "src")
OUTPUT_FILE = os.path.join(os.path.dirname(__file__), "qa_audit_report.json")

# Patterns to detect issues
PATTERNS = {
    "TODO_FIXME": re.compile(r'//\s*(TODO|FIXME|TBD|TBA|HACK|XXX)\b[:\s]*(.*)', re.IGNORECASE),
    "ANY_TYPE": re.compile(r':\s*any\b'),
    "CONSOLE_LOG": re.compile(r'\bconsole\.(log|debug|info|warn)\b'),
    # Only match real empty functions: requires parens before braces (excludes `const x = {}`)
    "EMPTY_FUNCTION": re.compile(r'(function\s+\w+\s*\([^)]*\)|=>)\s*\{\s*\}', re.MULTILINE),
    # Match actual placeholder/unimplemented content — NOT HTML placeholder= attributes or CSS placeholder- classes
    "PLACEHOLDER_TEXT": re.compile(r'(en construcción|coming soon|lorem ipsum|not implemented)', re.IGNORECASE),
    "HARDCODED_CREDS": re.compile(r'(password|secret|api_key|token)\s*[:=]\s*["\'][^"\']+["\']', re.IGNORECASE),
    "UNUSED_IMPORT": re.compile(r'^import\s+.*from\s+["\'].*["\'];?\s*$', re.MULTILINE),
}

SEVERITY = {
    "TODO_FIXME": "MEDIUM",
    "ANY_TYPE": "LOW",
    "CONSOLE_LOG": "LOW",
    "EMPTY_FUNCTION": "HIGH",
    "PLACEHOLDER_TEXT": "HIGH",
    "HARDCODED_CREDS": "CRITICAL",
    "UNUSED_IMPORT": "INFO",
}

LABELS = {
    "TODO_FIXME": "Comentario pendiente (TODO/FIXME)",
    "ANY_TYPE": "Uso de tipo 'any' (deuda técnica)",
    "CONSOLE_LOG": "Console.log residual",
    "EMPTY_FUNCTION": "Función/componente vacío",
    "PLACEHOLDER_TEXT": "Texto placeholder / módulo sin implementar",
    "HARDCODED_CREDS": "Credencial hardcodeada",
    "UNUSED_IMPORT": "Import posiblemente no utilizado",
}


def scan_file(filepath: str) -> list:
    """Scan a single file for issues."""
    issues = []
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()
            lines = content.split("\n")
    except Exception as e:
        return [{"type": "READ_ERROR", "severity": "HIGH", "line": 0, "message": str(e)}]

    rel_path = os.path.relpath(filepath, os.path.dirname(PROJECT_SRC))

    for line_num, line in enumerate(lines, 1):
        stripped = line.strip()

        # Skip empty lines
        if not stripped:
            continue

        # Check each pattern
        for pattern_name, pattern in PATTERNS.items():
            if pattern_name == "UNUSED_IMPORT":
                continue  # handled separately
            
            match = pattern.search(stripped)
            if match:
                # For ANY_TYPE, skip if inside a comment
                if pattern_name == "ANY_TYPE" and stripped.startswith("//"):
                    continue

                # For PLACEHOLDER_TEXT, skip HTML placeholder= attributes and CSS placeholder- classes
                if pattern_name == "PLACEHOLDER_TEXT":
                    # Skip lines that are HTML placeholder attributes: placeholder="..." or placeholder={...}
                    if re.search(r'placeholder\s*[={]', stripped, re.IGNORECASE):
                        continue
                    # Skip CSS class references containing 'placeholder-'
                    if 'placeholder-' in stripped.lower():
                        continue

                issues.append({
                    "type": pattern_name,
                    "severity": SEVERITY[pattern_name],
                    "label": LABELS[pattern_name],
                    "file": rel_path,
                    "line": line_num,
                    "code": stripped[:120],
                    "match": match.group(0)[:80] if match else "",
                })

    # Check for unused imports (heuristic: import something that's never referenced again)
    imports = []
    for line_num, line in enumerate(lines, 1):
        import_match = re.match(r'^import\s+(?:{([^}]+)}|(\w+))\s+from', line.strip())
        if import_match:
            imported_names = import_match.group(1) or import_match.group(2)
            if imported_names:
                for name in imported_names.split(","):
                    name = name.strip().split(" as ")[-1].strip()
                    # Skip bare 'type' keyword and handle 'type X' imports (TypeScript)
                    if name == "type" or not name:
                        continue
                    # Strip leading 'type ' prefix for TS type-only imports (e.g., 'type ReactNode')
                    if name.startswith("type "):
                        name = name[5:].strip()
                    if not name:
                        continue
                    # Count occurrences in the rest of the file (excluding imports)
                    non_import_content = "\n".join(
                        l for l in lines if not l.strip().startswith("import ")
                    )
                    count = len(re.findall(r'\b' + re.escape(name) + r'\b', non_import_content))
                    if count == 0:
                        issues.append({
                            "type": "UNUSED_IMPORT",
                            "severity": "INFO",
                            "label": LABELS["UNUSED_IMPORT"],
                            "file": rel_path,
                            "line": line_num,
                            "code": line.strip()[:120],
                            "match": f"'{name}' importado pero no referenciado",
                        })

    return issues


def scan_project() -> dict:
    """Scan the entire src directory."""
    all_issues = []
    files_scanned = 0
    
    for root, dirs, files in os.walk(PROJECT_SRC):
        # Skip node_modules and .next
        dirs[:] = [d for d in dirs if d not in ("node_modules", ".next", "__pycache__")]
        
        for filename in files:
            if filename.endswith((".ts", ".tsx", ".js", ".jsx")):
                filepath = os.path.join(root, filename)
                issues = scan_file(filepath)
                all_issues.extend(issues)
                files_scanned += 1

    # Generate summary
    summary = {
        "timestamp": datetime.now().isoformat(),
        "files_scanned": files_scanned,
        "total_issues": len(all_issues),
        "by_severity": {},
        "by_type": {},
    }

    for issue in all_issues:
        sev = issue["severity"]
        typ = issue["type"]
        summary["by_severity"][sev] = summary["by_severity"].get(sev, 0) + 1
        summary["by_type"][typ] = summary["by_type"].get(typ, 0) + 1

    return {
        "summary": summary,
        "issues": all_issues,
    }


def print_report(report: dict):
    """Print a formatted report to console."""
    summary = report["summary"]
    issues = report["issues"]
    
    print("=" * 70)
    print("  🔍 QA CODE AUDIT REPORT - FollowupGantt")
    print("=" * 70)
    print(f"  📅 Fecha: {summary['timestamp']}")
    print(f"  📁 Archivos escaneados: {summary['files_scanned']}")
    print(f"  🎯 Total hallazgos: {summary['total_issues']}")
    print()
    
    # By severity
    print("  📊 Por severidad:")
    for sev in ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]:
        count = summary["by_severity"].get(sev, 0)
        if count > 0:
            icon = {"CRITICAL": "🔴", "HIGH": "🟠", "MEDIUM": "🟡", "LOW": "🔵", "INFO": "⚪"}.get(sev, "")
            print(f"     {icon} {sev}: {count}")
    
    print()
    print("  📋 Por tipo:")
    for typ, count in sorted(summary["by_type"].items(), key=lambda x: -x[1]):
        print(f"     • {LABELS.get(typ, typ)}: {count}")
    
    print()
    print("-" * 70)
    
    # Group by file
    by_file = {}
    for issue in issues:
        f = issue["file"]
        by_file.setdefault(f, []).append(issue)
    
    for filepath, file_issues in sorted(by_file.items()):
        print(f"\n  📄 {filepath}")
        for issue in sorted(file_issues, key=lambda x: x["line"]):
            sev_icon = {"CRITICAL": "🔴", "HIGH": "🟠", "MEDIUM": "🟡", "LOW": "🔵", "INFO": "⚪"}.get(issue["severity"], "")
            print(f"     L{issue['line']:>4} {sev_icon} [{issue['severity']}] {issue['label']}")
            print(f"           {issue['code'][:100]}")
    
    print()
    print("=" * 70)
    
    if summary["by_severity"].get("CRITICAL", 0) > 0 or summary["by_severity"].get("HIGH", 0) > 0:
        print("  ❌ RESULTADO: REQUIERE CORRECCIONES ANTES DE DEPLOY")
    elif summary["total_issues"] > 0:
        print("  ⚠️  RESULTADO: APROBADO CON OBSERVACIONES")
    else:
        print("  ✅ RESULTADO: CÓDIGO APROBADO")
    
    print("=" * 70)


if __name__ == "__main__":
    report = scan_project()
    
    # Save JSON report
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    
    # Print to console
    print_report(report)
    
    print(f"\n  📝 Reporte completo guardado en: {OUTPUT_FILE}")