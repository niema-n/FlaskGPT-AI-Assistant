"""Deterministic provider outputs. No network access or code execution."""

PYTHON_BLOCKS = [
    'records = [{"age": 24, "montant": 10.0}, {"age": 42, "montant": 15.0}]\n',
    'def montant_total(records):\n    return sum(row["montant"] for row in records)\n',
    'from statistics import mean\n\nages = [row["age"] for row in records]\nprint(mean(ages))\n',
    'def verifier_colonnes(records, required):\n    for row in records:\n        if not required.issubset(row):\n            raise ValueError("Colonne manquante")\n',
    'from sklearn.pipeline import make_pipeline\nfrom sklearn.impute import SimpleImputer\nfrom sklearn.preprocessing import StandardScaler\nfrom sklearn.linear_model import LogisticRegression\nfrom sklearn.model_selection import train_test_split\n\n# X et y doivent être fournis et correspondre à une classification.\nX_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)\nmodel = make_pipeline(SimpleImputer(), StandardScaler(), LogisticRegression())\nmodel.fit(X_train, y_train)\npredictions = model.predict(X_test)\n',
]


def audit_answer():
    intro = '# Exemple technique\n\nLes colonnes `age` et `montant` sont fictives. Les données sont synthétiques, pas celles de votre fichier. Aucun résultat n’est présenté comme mesuré.\n\n'
    blocks = '\n\n'.join(f'## Exemple {i}\n\n```python\n{code}```' for i, code in enumerate(PYTHON_BLOCKS, 1))
    tables = '\n\n| Colonne fictive | Type |\n| --- | --- |\n| age | entier |\n| montant | réel |\n\n| Étape | Principe |\n| --- | --- |\n| Séparation | Avant ajustement |\n| Pipeline | Ajusté sur entraînement uniquement |\n'
    paragraph = ('Ces exemples expliquent une méthode et leurs hypothèses doivent être vérifiées avant utilisation. '
                 'La présence des colonnes, les types et la disponibilité des bibliothèques ne sont pas connus automatiquement. '
                 'Une syntaxe valide ne garantit pas un calcul correct. Les résultats ne sont pas exécutés. '
                 'Le jeu de test doit rester séparé pendant l’ajustement des transformations et la sélection du modèle. ')
    return intro + blocks + tables + '\n\n## Explications détaillées\n\n' + '\n\n'.join([paragraph] * 42) + '\n\nFIN_AUDIT'


CASES = {
    'AUDIT_FIVE': audit_answer(),
    'AUDIT_TABLE_LIMIT': '# Comparaison\n\n| Technique | Description | Cas d’usage |\n| --- | --- | --- |\n| SMOTE |',
    'AUDIT_CODE_BREAK': '# Exemple interrompu\n\n```python\nfor record in records:\n    print(',
    'AUDIT_NO_FINISH': 'La connexion se ferme sans raison de fin confirmée.',
    'AUDIT_INVALID_PYTHON': '```python\nfor number in range(3)\n    print(number)\n```',
}
CONTINUATION = '## Suite de la réponse\n\nL’élément interrompu est repris en entier.\n\n| Technique | Description | Cas d’usage |\n| --- | --- | --- |\n| SMOTE | Suréchantillonnage de l’entraînement uniquement | Exemple conditionnel |\n\nFin de l’exemple, sans résultat statistique inventé.'
