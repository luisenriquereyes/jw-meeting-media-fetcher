---
category: Configuration
title: 'Congregation sync'
layout: null
---

The brother designated as _videoconference organizer_ (VO) by the body of elders can use JWMMF to manage what media is made available to the technical A/V support team in his congregation.
The VO, or someone designated by him, can:

- upload <strong>additional</strong> media to be shared during a meeting, such as for the circuit overseer's visit, or for public speakers' talks
- <strong>hide</strong> media from JW.org that isn't relevant for a given meeting, for example, when a part has been replaced by the local branch
- add or remove <strong>recurring</strong> media, such as a year-text video, or an announcement slide

When congregation sync is enabled, the VO will use the ☁️ (cloud) button on the main screen of JWMMF to <a href="#/manage-media">manage meeting or recurring media</a>.

All who are synced to the same congregation will then receive the exact same media when they click the <em>Get media!</em> button.

Please note that the congregation sync feature is opt-in and entirely optional.

> <strong>Note:</strong> Enabling congregation sync automatically disables and hides the <em>Offer to import additional media</em> option.

### How it works

JWMMF's underlying sync mechanism uses WebDAV. This means that the VO (or someone under his supervision) needs to either:

- set up a secured WebDAV server that is web-accessible, <strong>or</strong>
- use a third-party cloud storage service that supports the WebDAV protocol (see the <code>Congregation sync hostname</code> setting in the <em>Congregation sync setup</em> section below).

All users that wish to be synchronized together will need to connect to the same WebDAV server using the connection information and credentials provided to them by their VO.

### Congregation sync setup

<table>
  <thead>
    <tr>
      <th>Setting</th>
      <th>Explanation</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>Congregation sync hostname</code></td>
      <td>Web address of the WebDAV server. Secure HTTP (HTTPS) is required. <br><br><blockquote><strong>Note:</strong> The label for this field is actually a button that, once clicked, will show a list of WebDAV providers that have been known to be compatible with JWMMF, and will automatically prefill certain settings for those providers. <br><br>This list is provided as a courtesy, and in no way represents an endorsement of any particular service or provider. The best server is always the one you own...</blockquote></td>
    </tr>
    <tr>
      <td><code>Congregation sync port</code></td>
      <td>Usually 443 for standard HTTPS, but might differ depending on the site. </td>
    </tr>
    <tr>
      <td><code>Congregation sync username</code> </td>
      <td>Username for the WebDAV service. </td>
    </tr>
    <tr>
      <td><code>Congregation sync password</code></td>
      <td>Password for the WebDAV service. <br><br><blockquote><strong>Note:</strong> As detailed in their respective support pages, an app-specific password might need to be created for <a href="https://support.box.com/hc/en-us/articles/360043696414-WebDAV-with-Box" target="_blank">Box</a> and <a href="https://koofr.eu/help/koofr_with_webdav/how-do-i-connect-a-service-to-koofr-through-webdav/" target="_blank">Koofr</a> in order to enable WebDAV connections to their services.</blockquote></td>
    </tr>
    <tr>
      <td><code>Congregation sync folder</code></td>
      <td>This is the folder that will be used to synchronize media for all congregation sync users. <br><br>You can either type/paste in a path, or use your mouse to navigate to the target folder. <br><br><blockquote><strong>Note:</strong> Make sure that all congregation sync users input the same folder path; otherwise the sync won't work as expected.</blockquote></td>
    </tr>
    <tr>
      <td><code>Congregation-wide settings</code></td>
      <td>Once the VO has configured the <em>Media setup</em> and <em>Meeting setup</em> sections of the <a href="#/configuration">JWMMF settings</a> on his own computer, he can then use this button to enforce certain settings for all congregation sync users (for example, meeting days, media language, conversion settings, and so on). This means that the selected settings will be forcefully applied for all synced users every time they open JWMMF.</td>
    </tr>
  </tbody>
</table>


### Using congregation sync to manage media

Once the setup is complete, you're ready to start <a href="#/manage-media">managing media</a> for your congregation's technical AV support team.


### Screenshots

<table class="showcase">
<tr>
<td><a href="https://github.com/sircharlo/jw-meeting-media-fetcher/blob/master/docs/screenshots/settings-2.png?raw=true" target="_blank"><img src="https://github.com/sircharlo/jw-meeting-media-fetcher/blob/master/docs/screenshots/settings-2.png?raw=true"></a></td>
<td>Congregation sync setup</td>
</tr>
</table>
