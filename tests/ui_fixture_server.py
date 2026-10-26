"""Local browser-test server: temporary SQLite database and deterministic fake Groq.

Run with `poetry run python tests/ui_fixture_server.py`. Never uses live Groq.
"""
import sys
import tempfile
import time
from pathlib import Path
from types import SimpleNamespace
from audit_fixtures import CASES, CONTINUATION

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app as flaskgpt


def long_answer():
    paragraph = (
        "Une interface de conversation doit laisser toute la place à la lecture. "
        "Chaque explication reste accessible, même lorsque le texte devient très long. "
        "La personne peut remonter dans les messages, examiner un exemple et reprendre "
        "sa lecture sans perdre sa position. Le composeur reste disponible en bas. "
        "Les titres structurent la réponse et les espaces séparent clairement les idées. "
    )
    sections = ["# Concevoir une conversation confortable\n\nVoici un guide avec **des exemples**, *des explications* et [un lien](https://example.com)."]
    for number in range(1, 25):
        sections.append(f"## Étape {number} — Lisibilité et navigation\n\n{paragraph * 2}\n\n"
                        "### Points à vérifier\n\n- Lire les messages sans interruption.\n- Conserver une typographie confortable.\n\n"
                        "1. Ouvrir la conversation.\n2. Parcourir toute la réponse.\n\n"
                        "> Le contenu doit rester accessible sur tous les écrans.\n")
    sections.append("## Un tableau à explorer\n\n| Domaine | Exemple détaillé | Résultat attendu | Vérification | État |\n"
                    "|---|---|---|---|---|\n| Lecture | Réponse de plusieurs milliers de mots | Aucun texte coupé | Mobile et ordinateur | Disponible |\n")
    sections.append("## Exemple Python complet\n\n```python\n" +
                    "\n".join(f'print("Ligne {i}: {"exemple " * 20}")' for i in range(1, 351)) +
                    "\n```\n\nFIN_LONGUE_REPONSE — Tout le contenu est accessible.")
    return "\n\n".join(sections)


class FakeCompletions:
    failed_once = False

    def create(self, **kwargs):
        if not kwargs.get("stream"):
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="## Résumé\n\nUne conversation de test lisible et accessible."))], usage=None)
        prompt = kwargs["messages"][-1]["content"]
        if "ERREUR_TEST" in prompt and not self.failed_once:
            self.failed_once = True
            raise RuntimeError("Simulated provider failure")
        text = CASES.get(prompt) or (CONTINUATION if prompt.startswith('Continue la réponse précédente') else
            long_answer() if "LONGUE_TEST" in prompt else "Une **réponse courte**, lisible et complète.\n\n```python\nprint('Bonjour')\n```")

        def chunks():
            size = 1200 if "LONGUE_TEST" in prompt or prompt in CASES else 18
            for offset in range(0, len(text), size):
                time.sleep(.12)
                yield SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=text[offset:offset + size]))], usage=None)
                if "INTERRUPTION_TEST" in prompt and offset >= 36:
                    raise RuntimeError("Simulated interrupted stream")
            if prompt == 'AUDIT_CODE_BREAK':
                raise RuntimeError('Simulated provider disconnect during code')
            if prompt != 'AUDIT_NO_FINISH':
                yield SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=None),
                    finish_reason='length' if prompt == 'AUDIT_TABLE_LIMIT' else 'stop')], usage=None)
        return chunks()


def complex_answer():
    """Valid GFM; multi-line examples are deliberately outside the tables."""
    examples = '''# Nettoyer des données avec Python

Une réponse avec des **titres**, de l’*italique*, des accents : été, café, déjà.
Utilisez `df.shape` pour connaître les dimensions et consultez [la documentation](https://pandas.pydata.org/).

## Trois exemples reproductibles

### 1. Charger les données

```python
import pandas as pd

def charger(chemin):
    données = pd.read_csv(chemin)
    return données.drop_duplicates()
```

### 2. Filtrer les valeurs

```python
Q1 = df["col"].quantile(0.25)
Q3 = df["col"].quantile(0.75)
IQR = Q3 - Q1
mask = (df["col"] >= Q1 - 1.5 * IQR) & (df["col"] <= Q3 + 1.5 * IQR)
df = df[mask]
```

### 3. Vérifier et exporter

```python
for colonne in ["âge", "montant"]:
    assert colonne in df.columns
    print(f"Colonne vérifiée : {colonne}")
df.to_csv("données.csv", index=False)
```

## Comparer les méthodes

| Méthode | Exemple inline | Alignement numérique |
| :--- | :---: | ---: |
| IQR | `df["col"].quantile(0.25)` | 25 |
| Filtre OU | `a \\| b` | 100 |
| Caractères spéciaux | `<div>&</div>` | 3 |

| Contrôle | Résultat |
| --- | --- |
| Valeurs manquantes | `df.isna().sum()` |
| Accents | Éducation, qualité, € |

> Les exemples multilignes restent en dehors des tableaux.

- Inspecter les colonnes.
- Préserver les valeurs originales.

1. Nettoyer une copie.
2. Vérifier les résultats.

---

'''
    return examples + long_answer().split("## Un tableau à explorer")[0] + "\n\nFIN_COMPLEXE — Tous les exemples sont disponibles."


if __name__ == "__main__":
    @flaskgpt.app.get('/__test__/audit-fixtures')
    def audit_fixtures():
        return flaskgpt.jsonify(CASES)

    with tempfile.TemporaryDirectory(prefix="flaskgpt-ui-") as directory:
        flaskgpt.DATABASE_PATH = str(Path(directory) / "conversations.sqlite3")
        flaskgpt.init_db()
        flaskgpt.client = SimpleNamespace(chat=SimpleNamespace(completions=FakeCompletions()))
        with flaskgpt.app.test_client() as client:
            for title, answer in [("Lecture longue", long_answer()), ("Lecture courte", "Bonjour ! Voici une **réponse courte** et lisible."), ("Markdown complexe", complex_answer())]:
                conversation = client.post("/api/conversations", json={"title": title, "domain": "Général"}).get_json()
                with flaskgpt.database_connection() as connection:
                    connection.execute("INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, 'user', ?, ?)",
                                       (conversation["id"], "Comment rendre une conversation agréable à lire ?", flaskgpt.current_timestamp()))
                flaskgpt.save_assistant_message(conversation["id"], answer, generation_info=flaskgpt.generation_state('stop', True))
        flaskgpt.app.run(port=5001, debug=False)
