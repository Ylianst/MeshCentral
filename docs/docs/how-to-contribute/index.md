# Contribute to MeshCentral 

## Contributing to MeshCentral via GitHub Pull Request

If you're looking to contribute beyond translations, such as updating documentation or enhancing the software by adding features or fixing bugs, the process involves several key steps:

1. **Fork the Repository:** Start by forking the [MeshCentral](https://github.com/Ylianst/MeshCentral) repository on GitHub. This creates a copy of the repository under your own GitHub account, allowing you to make changes without affecting the original project.

2. **Make Your Changes**
    - In your forked repository, create a new branch to keep your changes organized. This helps in managing different contributions separately.
    - Make the necessary changes in your repository. This could involve updating documentation files or modifying code to add new features or fix bugs.

3. **Review Your Changes:** Before submitting your work, carefully review the changes you’ve made. Check the "Files Changed" section on GitHub to ensure that all modifications are intended and correctly implemented.

4. **Submit a Pull Request**
    - Once your changes are ready and reviewed, submit a pull request (PR) from your branch to the `master` branch of the main MeshCentral repository.
    - When creating the pull request, provide a clear and detailed description of what changes have been made and why. This helps maintainers understand the purpose of your contributions.

5. **Wait for Review:** After submitting your pull request, wait for a project maintainer to review your contribution. Review time can vary depending on the complexity of the changes and the availability of the maintainers.

6. **Respond to Feedback:** The maintainer may request further modifications or provide feedback on your pull request. Be prepared to make additional changes based on their suggestions to ensure that your contribution meets the project’s standards and requirements.

7. **Final Steps:** Once your pull request is approved and merged by a maintainer, your contributions will be incorporated into the MeshCentral project. Congratulations, and thank you for helping improve MeshCentral! 

---

## Contribute to MeshCentral's Multilingual Support

To make MeshCentral multilingual, your contributions are crucial. Follow these steps to translate the interface into various languages.

1. **Remove Local Translations:** Delete `translate.json` from your `meshcentral-data` folder. This file contains your local copy of translations, which may become outdated as new features and texts are added.

2. **Access MeshCentral:** Ensure you are logged into MeshCentral.
3. **Open Translation Tool:** Visit `https://YOURMESHCENTRALSERVER.COM/translator.htm` to access the translation interface.
4. **Choose a Language:** Select the language you wish to translate from the list provided.

5. **Translate Text:** Use the search function or scroll through the list to find text segments you want to translate. Utilize the "show no translations only" checkbox to filter untranslated texts.
6. **Enter Translations:** For each text segment, enter your translation in the bottom box (not the top one) and click `SET (F1)`.
7. **Repeat Translation:** Continue translating by repeating steps 5 and 6 for other texts as desired.

8. **Save and Apply Translations**
    - Click `SAVE TO SERVER (F3)` to save your translations to `meshcentral-data/translate.json` locally in your MeshCentral server.
    - Optionally, click `SAVE TO FILE (F4)` to download the `translate.json` file for offline review or sharing.

9. **Deploy Translations:** Click `TRANSLATE SERVER` and allow some time for the process to complete (approximately 5-15 minutes depending on server specifications). This command line output will indicate when the translation is complete.  
![](images/translation-msg-output.png)

10. **Finalize Changes:** It’s crucial to restart MeshCentral to ensure that the translated files are picked up correctly.
11. **Share your translations:** Once a language translation is complete, take the latest `translation.json` and share it by emailing it to the maintainer (Ylianst, `ylianst@gmail.com`) or by submitting it to the MeshCentral GitHub repository via a pull request.

---

#### Additional Information:
  - If you make any changes to `default.handlebars`, run the translate server to propagate these modifications to the language-specific handlebar files located in `node_modules/meshcentral/views/translations`.

By following these steps, you help MeshCentral support any language you choose, making it more accessible worldwide. By sharing your translations with us, you also help make these languages available to other users, improving the community and extending the software's reach.
