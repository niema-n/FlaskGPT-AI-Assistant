# Correction du rendu Markdown de FlaskGPT

La correction porte sur trois causes distinctes : la sortie du modèle, le rendu
du Markdown incomplet pendant le streaming et la présentation des actions.

| Problème | Diagnostic confirmé | Correction |
| --- | --- | --- |
| Python multiligne dans un tableau | La réponse enregistrée contient une cellule commençant par une clôture Python, suivie de plusieurs lignes hors de la rangée. La source est invalide. | Consignes GFM ajoutées au message système : exemples multilignes hors des tableaux, cellules courtes et barres verticales échappées. |
| Clôture de code absente | Une réponse enregistrée se termine dans un bloc Python sans clôture. La cause exacte de cette fin prématurée n’est pas établie. Showdown reproduit aussi le défaut avec une clôture encore ouverte pendant la génération. | Marked traite les clôtures ouvertes comme du code jusqu’à la fin disponible ; le rendu final est recalculé sur la source complète reçue. |
| Préfixe `python**Copier le code**` | Les réponses enregistrées examinées ne contiennent pas « Copier ». Le préfixe exact n’a donc pas été confirmé dans la sortie du modèle. Les commandes appartiennent au DOM de l’interface. | Langage et bouton séparés dans une barre dédiée. Copier un bloc renvoie son code seul ; copier la réponse renvoie le Markdown original, sans commandes d’interface. |
| Alignements des tableaux | Le CSS imposait l’alignement à gauche. | Alignements GFM gauche/centre/droite conservés via des attributs filtrés et des règles CSS explicites. |
| Instabilité pendant le streaming | Chaque mise à jour remplaçait tout le HTML de la réponse. | Mise à jour limitée aux blocs modifiés, conservation des nœuds de code/tableau et écouteurs de copie délégués. |
| Actions encombrantes | Copie et évaluations occupaient deux barres séparées ; les notes ajoutaient une décoration au message entier. | Une barre d’actions responsive, sélection visible sur le bouton évalué, mêmes valeurs et enregistrement SQLite. |

Le parseur est Marked 18.1.2, figé dans npm et servi localement avec sa licence.
DOMPurify filtre le HTML avant son insertion dans le DOM. Les actions sont ajoutées
ensuite par l’interface. Ce choix suit les options GFM et la séparation entre parsing
et sanitization décrites dans la [documentation officielle de Marked](https://marked.js.org/using_advanced).

Fichiers concernés :

- `app.py` : consignes communes de formatage, ajoutées sans remplacer les spécialisations.
- `templates/index.html` : chargement du parseur local.
- `static/dist/js/script.js` : rendu sécurisé, mises à jour du DOM, copie et actions.
- `static/css/input.css` et `static/dist/css/style.css` : code, tableaux, actions et défilement.
- `package.json`, `package-lock.json`, `scripts/vendor-markdown.cjs` et `static/dist/vendor/marked/` : dépendance figée et bundle local reproductible.
- `tests/test_app.py`, `tests/ui_fixture_server.py`, `tests/markdown_browser.cjs` et `tests/BROWSER_TESTS.md` : régressions, fixtures et instructions d’exécution.

Résultats :

- `npm run build:css` : réussi.
- `node --check static/dist/js/script.js` : réussi.
- `poetry run python -m unittest discover -s tests -v` : 30 tests réussis.
- `tests/conversation_browser.cjs` : réussi, dont navigation, évaluations, exports TXT/JSON/PDF, résumé PDF, reprise après erreur et conservation d’une réponse interrompue.
- `tests/markdown_browser.cjs` : réussi avec plus de 2 000 mots, trois blocs Python, deux tableaux, trois niveaux de titres, listes, citations, code inline et accents.
- Copies vérifiées dans le presse-papiers, avec prise en compte des fins de ligne Windows.
- Streaming UTF-8 découpé au milieu des caractères et des marqueurs Markdown : texte final identique, aucun bouton dupliqué, rendu final identique au rendu hors streaming.
- Tests XSS, stabilité des nœuds, alignements, caractères spéciaux et clavier réussis.
- Vérification générale sur six dimensions d’écran dans les deux thèmes ; captures Markdown supplémentaires sur ordinateur, tablette et mobile.

Les captures ont été réellement ouvertes et examinées, notamment
[le code sur ordinateur](instance/markdown-review/code-1280-dark.png),
[les tableaux sur mobile](instance/markdown-review/tables-390-dark.png) et
[les actions sur mobile](instance/markdown-review/actions-mobile-dark.png).
Elles restent dans `instance/`, exclu de Git.

Limites : les essais visuels utilisent Chrome automatisé, pas Safari, Firefox ou
un téléphone physique. Le fournisseur est simulé pour les tests ; les consignes
réellement transmises à Groq sont vérifiées par les tests Python, sans demander
une nouvelle génération au service réel. Elles réduisent les erreurs de formatage
sans garantir que chaque sortie future du modèle sera valide. Aucun moteur
mathématique n’était présent ; aucun n’a été ajouté.

Les conversations existantes et leur Markdown sont conservés. Un tableau déjà
mal formé n’est pas reconstruit arbitrairement : le parseur ne peut pas deviner
les colonnes et clôtures voulues. Les nouvelles consignes s’appliquent aux prochaines
réponses ; elles ne réécrivent pas rétroactivement l’historique.
