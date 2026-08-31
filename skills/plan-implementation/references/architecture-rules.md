# Regles Architecture

Le plan classe **chaque ID** : applique ou `N/A — raison`. Detail d'implementation dans `/implement-tdd` et les skills de tests ; ne duplique pas leurs exemples ici.

| ID | Regle | Quand | Decision de plan et preuve | Exception |
|----|-------|-------|----------------------------|-----------|
| APP-01 | Handler orchestre : charge, appelle le Domain, sauvegarde events, retourne resultat. | Handler cree/modifie. | Decrire ce flux ; aucune RM ni mutation directe dans handler. | Query pure : lecture + resultat seulement. |
| APP-02 | Command exprime intention et retourne ID ; Query lit et retourne sa charge utile (`Paging<T>` paginee, `IReadOnlyList<T>` bornee, agregat ou reponse unitaire) — jamais `Result<T>`. | Contrat Application cree/modifie. | Nommer contrat, entree et sortie observable. | Aucune. |
| APP-03 | Repository centre aggregate et traduit events en persistence, ainsi que les violations de contrainte en exception domain. | Persistence aggregate touchee. | Nommer aggregate, events et cas Save/Restore ; nommer l'index unique et l'exception rendue. | N/A si persistence non touchee. |
| APP-04 | WebAPI traduit HTTP ; Infrastructure traduit IO ; aucune ne porte de RM. | WebAPI ou Infrastructure touchee. | Localiser mapping/IO ; RM dans Domain/Application. | N/A si couche non touchee. |
| APP-05 | Borne de ressource portee par son porteur dedie, jamais recodee ad hoc. | Route publique ou lecture non paginee ajoutee/modifiee. | Nommer la borne et son porteur : transport (taille de corps, debit) en WebAPI (`RequestLimits`, rate limiting) ; pagination normalisee a la creation de la query (`Application/Core/PaginationBounds`) ; plafond de lecture cote persistence (`Infrastructure/Database/QueryLimits`). Aucune borne dans le Domain, aucune borne reecrite a la main dans un handler. | N/A si aucune route ni lecture non bornee touchee. |
| PERF-01 | Cout d'acces Infrastructure borne, independant de la taille d'entree. | Handler ou IO touche. | Enoncer lectures/ecritures ; aucune lecture IO dans boucle pilotee par entree. | Cout non borne uniquement si plan le justifie explicitement. |
