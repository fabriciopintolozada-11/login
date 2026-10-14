#!/bin/sh
# Arreglo automático de tests fallidos (sin IA ni APIs).
# Busca en el historial la última versión del código fuente que pasa los tests
# ACTUALES y la restaura. Los tests (test/) nunca se modifican.
# Uso: sh hooks/fix.sh   (lo llaman hooks/pre-push y el workflow de GitHub Actions)

SRC="server public"   # carpetas que se pueden restaurar
MAX=20                # commits hacia atrás que se revisan

if ! git diff --quiet HEAD -- $SRC; then
  echo "Hay cambios sin commit en $SRC; no se aplica el arreglo automático."
  exit 1
fi

for commit in $(git rev-list --max-count=$MAX HEAD~1 2>/dev/null); do
  git restore --source="$commit" --worktree -- $SRC 2>/dev/null || continue
  if npm test >/dev/null 2>&1; then
    echo "Arreglado: $SRC restaurado a $(git log -1 --format='%h (%s)' "$commit"), el último estado con los tests en verde."
    git diff --stat -- $SRC
    exit 0
  fi
done

git restore --source=HEAD --worktree -- $SRC
echo "No se encontró ninguna versión en los últimos $MAX commits que pase los tests. Hay que corregirlo a mano."
exit 1
