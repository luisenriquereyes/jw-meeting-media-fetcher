const animationDuration = 200,
  axios = require("axios"),
  remote = require("@electron/remote"),
  {shell} = require("electron"),
  $ = require("jquery");
function checkInternet(online) {
  if (online) {
    $("#overlayInternetCheck").fadeIn(animationDuration, () => {
      $("#overlayInternetFail").stop().hide();
    });
    require("electron").ipcRenderer.send("autoUpdate");
  } else {
    $("#overlayInternetFail").fadeIn(animationDuration, () => {
      $("#overlayInternetCheck").stop().hide();
    });
    updateOnlineStatus();
  }
}
const updateOnlineStatus = async () => {
  checkInternet((await isReachable("www.jw.org")));
};
updateOnlineStatus();
require("electron").ipcRenderer.on("hideThenShow", (event, message) => {
  $("#overlay" + message[1]).fadeIn(animationDuration, () => {
    $("#overlay" + message[0]).stop().hide();
  });
});
require("electron").ipcRenderer.on("macUpdate", () => {
  $("#bg-mac-update").fadeIn();
  $("#btn-settings").addClass("in-danger");
  $("#version").addClass("bg-danger in-danger").removeClass("bg-secondary").append(" <i class='fas fa-mouse-pointer'></i>").click(function() {
    shell.openExternal("https://github.com/sircharlo/jw-meeting-media-fetcher/releases/latest");
  });
});
require("electron").ipcRenderer.on("goAhead", () => {
  $("#overlayPleaseWait").fadeIn(animationDuration, () => {
    $("#overlayUpdateCheck").stop().hide();
    goAhead();
  });
});

const aspect = require("aspectratio"),
  bootstrap = require("bootstrap"),
  { createClient } = require("webdav"),
  dayjs = require("dayjs"),
  ffmpeg = require("fluent-ffmpeg"),
  fs = require("graceful-fs"),
  fullHd = [1280, 720],
  glob = require("glob"),
  hme = require("h264-mp4-encoder"),
  datetime = require("flatpickr"),
  i18n = require("i18n"),
  os = require("os"),
  path = require("path"),
  sizeOf = require("image-size"),
  sqljs = require("sql.js"),
  zipper = require("adm-zip");

dayjs.extend(require("dayjs/plugin/isoWeek"));
dayjs.extend(require("dayjs/plugin/isBetween"));
dayjs.extend(require("dayjs/plugin/isSameOrBefore"));
dayjs.extend(require("dayjs/plugin/customParseFormat"));
dayjs.extend(require("dayjs/plugin/duration"));

var baseDate = dayjs().startOf("isoWeek"),
  currentStep,
  datepickers,
  dryrun = false,
  ffmpegIsSetup = false,
  jsonLangs = {},
  jwpubDbs = {},
  meetingMedia,
  myModal = new bootstrap.Modal(document.getElementById("staticBackdrop"), {
    backdrop: "static",
    keyboard: false
  }),
  now = dayjs().hour(0).minute(0).second(0).millisecond(0),
  paths = {
    app: remote.app.getPath("userData")
  },
  pendingMusicFadeOut = {},
  perfStats = {},
  prefix,
  prefs = {},
  tempMediaArray = [],
  totals = {},
  webdavIsAGo = false,
  stayAlive,
  webdavClient;
paths.langs = path.join(paths.app, "langs.json");
paths.lastRunVersion = path.join(paths.app, "lastRunVersion.json");
paths.prefs = path.join(paths.app, "prefs.json");

datepickers = datetime(".timePicker", {
  enableTime: true,
  noCalendar: true,
  dateFormat: "H:i",
  time_24hr: true,
  minuteIncrement: 15,
  minTime: "06:00",
  maxTime: "22:00",
  onClose: function() {
    var initiatorEl = $($(this)[0].element);
    $("#" + initiatorEl.data("target")).val(initiatorEl.val()).change();
  }
});

function goAhead() {
  if (fs.existsSync(paths.prefs)) {
    try {
      prefs = JSON.parse(fs.readFileSync(paths.prefs));
    } catch (err) {
      console.error(err);
    }
    prefsInitialize();
  }
  updateCleanup();
  getInitialData();
  dateFormatter();
  $("#overlaySettings input:not(.timePicker), #overlaySettings select, #overlayWebdav input, #overlayWebdav select").on("change", function() {
    if ($(this).prop("tagName") == "INPUT") {
      if ($(this).prop("type") == "checkbox") {
        prefs[$(this).prop("id")] = $(this).prop("checked");
      } else if ($(this).prop("type") == "radio") {
        prefs[$(this).closest("div").prop("id")] = $(this).closest("div").find("input:checked").val();
      } else if ($(this).prop("type") == "text" || $(this).prop("type") == "password"  || $(this).prop("type") == "hidden" || $(this).prop("type") == "range") {
        prefs[$(this).prop("id")] = $(this).val();
      }
    } else if ($(this).prop("tagName") == "SELECT") {
      prefs[$(this).prop("id")] = $(this).find("option:selected").val();
    }
    fs.writeFileSync(paths.prefs, JSON.stringify(Object.keys(prefs).sort().reduce((acc, key) => ({...acc, [key]: prefs[key]}), {}), null, 2));
    if ($(this).prop("id").includes("lang")) {
      dateFormatter();
    }
    if ($(this).prop("id") == "congServer" && $(this).val() == "") {
      $("#congServerPort, #congServerUser, #congServerPass, #congServerDir, #webdavFolderList").val("").empty().change();
    }
    if ($(this).prop("id").includes("cong")) {
      webdavSetup();
    }
    setVars();
    if ($(this).prop("id").includes("lang")) {
      getTranslations();
      updateSongs();
    }
    if ($(this).prop("id").includes("cong") || $(this).prop("name").includes("Day")) {
      cleanUp([paths.media]);
    }
    validateConfig();
  });
  $("#autoRunAtBoot").on("change", function() {
    remote.app.setLoginItemSettings({
      openAtLogin: prefs.autoRunAtBoot
    });
  });
  $("#mwDay input, #weDay input").on("change", function() {
    $(".alertIndicators").removeClass("meeting").find("i").addClass("fa-spinner").removeClass("fa-check-circle");
    $("#day" + prefs.mwDay + ", #day" + prefs.weDay).addClass("meeting");
  });
}
function additionalMedia() {
  perf("additionalMedia", "start");
  currentStep = "additionalMedia";
  return new Promise((resolve)=>{
    $("#chooseMeeting").empty();
    for (var meeting of [prefs.mwDay, prefs.weDay]) {
      let meetingDate = baseDate.add(meeting, "d").format("YYYY-MM-DD");
      $("#chooseMeeting").append("<input type='radio' class='btn-check' name='chooseMeeting' id='" + meetingDate + "' autocomplete='off'><label class='btn btn-outline-primary' for='" + meetingDate + "'" + (Object.prototype.hasOwnProperty.call(meetingMedia, meetingDate) ? "" : " style='display: none;'") + ">" + meetingDate + "</label>");
    }
    $(".relatedToUpload, .relatedToUploadType, #btnCancelUpload").fadeTo(animationDuration, 0);
    $("#btnDoneUpload").fadeTo(animationDuration, 1);
    $("#overlayUploadFile").fadeIn();
    $("#btnDoneUpload").on("click", function() {
      $("#overlayUploadFile").slideUp(animationDuration);
      $("#chooseMeeting input:checked, #chooseUploadType input:checked").prop("checked", false);
      $("#fileList, #filePicker, #jwpubPicker, #enterPrefix input").val("").empty().change();
      $("#chooseMeeting .active, #chooseUploadType .active").removeClass("active");
      removeEventListeners();
      perf("additionalMedia", "stop");
      resolve();
    });
  });
}
function addMediaItemToPart (date, paragraph, media) {
  if (!meetingMedia[date]) meetingMedia[date] = [];
  if (meetingMedia[date].filter(part => part.title == paragraph).length === 0) {
    meetingMedia[date].push({
      title: paragraph,
      media: []
    });
  }
  media.folder = date;
  meetingMedia[date].find(part => part.title == paragraph).media.push(media);
  meetingMedia[date] = meetingMedia[date].sort((a, b) => a.title > b.title && 1 || -1);
}
function cleanUp(dirs) {
  perf("cleanUp", "start");
  for (var lookinDir of dirs) {
    $("#statusIcon").addClass("fa-broom").removeClass("fa-photo-video");
    try {
      if (fs.existsSync(lookinDir)) {
        fs.rmSync(lookinDir, {
          recursive: true
        });
      }
    } catch(err) {
      console.error(err);
    }
    $("#statusIcon").addClass("fa-photo-video").removeClass("fa-broom");
  }
  perf("cleanUp", "stop");
}
function convertPdf(mediaFile) {
  return new Promise((resolve)=>{
    var pdfjsLib = require("pdfjs-dist/build/pdf.js");
    var pdfjsLibWorker = require("pdfjs-dist/build/pdf.worker.entry.js");
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsLibWorker;
    pdfjsLib.getDocument(mediaFile).promise.then(async function(pdf) {
      for (var pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        await convertPdfPage(mediaFile, pdf, pageNum);
      }
      fs.rmSync(mediaFile);
      resolve();
    });
  });
}
function convertPdfPage(mediaFile, pdf, pageNum) {
  return new Promise((resolve)=>{
    pdf.getPage(pageNum).then(function(page) {
      var mediaFileConverted = path.join(path.dirname(mediaFile), path.basename(mediaFile, path.extname(mediaFile)) + "-" + String(pageNum).padStart(2, "0") + ".png");
      $("body").append("<div id='pdf' style='display: none;'>");
      $("div#pdf").append("<canvas id='pdfCanvas'></canvas>");
      var scale = fullHd[1] / page.getViewport({scale: 1}).height * 4;
      var viewport = page.getViewport({scale: scale});
      var canvas = $("#pdfCanvas")[0];
      canvas.height = fullHd[1] * 4;
      canvas.width = page.getViewport({scale: scale}).width;
      var context = canvas.getContext("2d");
      var renderContext = {
        canvasContext: context,
        viewport: viewport
      };
      var renderTask = page.render(renderContext);
      renderTask.promise.then(function() {
        fs.writeFileSync(mediaFileConverted, new Buffer(canvas.toDataURL().replace(/^data:image\/\w+;base64,/, ""), "base64"));
        $("div#pdf").remove();
        resolve();
      });
    });
  });
}
function convertSvg(mediaFile) {
  return new Promise((resolve)=>{
    var mediaFileConverted = path.join(path.dirname(mediaFile), path.basename(mediaFile, path.extname(mediaFile)) + ".png");
    var svgFile = window.URL.createObjectURL(new Blob([fs.readFileSync(mediaFile, "utf8").replace(/(<svg[ a-zA-Z=":/.0-9%]*)(width="[0-9%]*")([ a-zA-Z=":/.0-9%]*>)/gm, "$1height='" + fullHd[1] * 4 + "'$3")], {type:"image/svg+xml;charset=utf-8"}));
    $("body").append("<div id='svg' style='display: none;'>");
    $("div#svg").append("<img id='svgImg'>").append("<canvas id='svgCanvas'></canvas>");
    $("img#svgImg").on("load", function() {
      var canvas = $("#svgCanvas")[0],
        image = $("img#svgImg")[0];
      canvas.height = image.height;
      canvas.width  = image.width;
      canvas.getContext("2d").drawImage(image, 0, 0);
      fs.writeFileSync(mediaFileConverted, new Buffer(canvas.toDataURL().replace(/^data:image\/\w+;base64,/, ""), "base64"));
      fs.rmSync(mediaFile);
      $("div#svg").remove();
      return resolve();
    });
    $("img#svgImg").prop("src", svgFile);
  });
}
async function convertUnusableFiles() {
  for (let pdfFile of glob.sync(path.join(paths.media, "*", "*pdf"))) {
    try {
      await convertPdf(pdfFile);
    } catch(err) {
      console.error(err);
    }
  }
  for (let svgFile of glob.sync(path.join(paths.media, "*", "*svg"))) {
    try {
      await convertSvg(svgFile);
    } catch(err) {
      console.error(err);
    }
  }
}
function createMediaNames() {
  perf("createMediaNames", "start");
  for (var h = 0; h < Object.values(meetingMedia).length; h++) { // meetings
    var meeting = Object.values(meetingMedia)[h];
    for (var i = 0; i < meeting.length; i++) { // parts
      for (var j = 0; j < meeting[i].media.length; j++) { // media
        var fileExt = (meeting[i].media[j].filetype ? meeting[i].media[j].filetype : path.extname((meeting[i].media[j].url ? meeting[i].media[j].url : meeting[i].media[j].filepath)));
        meeting[i].media[j].safeName = sanitizeFilename((i + 1).toString().padStart(2, "0") + "-" + (j + 1).toString().padStart(2, "0") + " - " + meeting[i].media[j].title + "." + fileExt);
      }
    }
  }
  perf("createMediaNames", "stop");
}
function createVideoSync(mediaDir, media){
  return new Promise((resolve)=>{
    var mediaName = path.basename(media, path.extname(media));
    if (path.extname(media).includes("mp3")) {
      ffmpegSetup().then(function () {
        ffmpeg(path.join(paths.media, mediaDir, media))
          .on("end", function() {
            return resolve();
          })
          .on("error", function(err) {
            console.error(err.message);
            return resolve();
          })
          .noVideo()
          .save(path.join(paths.media, mediaDir, mediaName + ".mp4"));
      });
    } else {
      try {
        var convertedImageDimesions = [];
        var imageDimesions = sizeOf(path.join(paths.media, mediaDir, media));
        if (imageDimesions.orientation && imageDimesions.orientation >= 5) {
          [imageDimesions.width, imageDimesions.height] = [imageDimesions.height, imageDimesions.width];
        }
        convertedImageDimesions = aspect.resize(imageDimesions.width, imageDimesions.height, (fullHd[1] / fullHd[0] > imageDimesions.height / imageDimesions.width ? (imageDimesions.width > fullHd[0] ? fullHd[0] : imageDimesions.width) : null), (fullHd[1] / fullHd[0] > imageDimesions.height / imageDimesions.width ? null : (imageDimesions.height > fullHd[1] ? fullHd[1] : imageDimesions.height)));
      } catch (err) {
        console.error("Unable to get dimensions for:", path.join(paths.media, mediaDir, media), "Setting manually...", err);
        convertedImageDimesions = [imageDimesions.width, imageDimesions.height];
      }
      if (convertedImageDimesions.toString() == fullHd.toString() || convertedImageDimesions.toString() == [Math.round(parseInt(prefs.maxRes.replace(/\D/g, "")) * 16 / 9), parseInt(prefs.maxRes.replace(/\D/g, ""))].toString()) convertedImageDimesions = convertedImageDimesions.map(function (dimension) {
        return dimension - 1;
      });
      convertedImageDimesions = convertedImageDimesions.map(function (dimension) {
        return (dimension % 2 ? dimension - 1 : dimension);
      });
      $("body").append("<div id='convert' style='display: none;'>");
      $("div#convert").append("<img id='imgToConvert'>").append("<canvas id='imgCanvas'></canvas>");
      hme.createH264MP4Encoder().then(function (encoder) {
        $("img#imgToConvert").on("load", function() {
          var canvas = $("#imgCanvas")[0],
            image = $("img#imgToConvert")[0];
          encoder.quantizationParameter = 10;
          encoder.width = canvas.width = image.width = convertedImageDimesions[0];
          encoder.height = canvas.height = image.height = convertedImageDimesions[1];
          encoder.initialize();
          canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
          encoder.addFrameRgba(canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data);
          encoder.finalize();
          fs.writeFileSync(path.join(paths.media, mediaDir, mediaName + ".mp4"), encoder.FS.readFile(encoder.outputFilename));
          encoder.delete();
          $("div#convert").remove();
          return resolve();
        });
        $("img#imgToConvert").prop("src", path.join(paths.media, mediaDir, media));
      });
    }
  });
}
function dateFormatter() {
  var locale = "en";
  try {
    locale = jsonLangs.filter(lang => lang.langcode == prefs.lang)[0].symbol;
    locale !== "en" && require("dayjs/locale/" + locale);
  } catch(err) {
    console.error("Date locale " + locale + " not found, falling back to 'en'");
  }
  $(".today").removeClass("today");
  for (var d = 0; d < 7; d++) {
    $("#day" + d + " .dayLongDate .dayOfWeek").text(baseDate.clone().add(d, "days").locale(locale).format("ddd"));
    $("#day" + d + " .dayLongDate .dayOfWeekLong").text(baseDate.clone().add(d, "days").locale(locale).format("dddd"));
    $("#day" + d + " .dayLongDate .dateOfMonth .date").text(baseDate.clone().add(d, "days").locale(locale).format("DD"));
    $("#day" + d + " .dayLongDate .dateOfMonth .month").text(baseDate.clone().add(d, "days").locale(locale).format("MMM"));
    $("#mwDay label:eq(" + d + ")").text(baseDate.clone().add(d, "days").locale(locale).format("dd"));
    $("#weDay label:eq(" + d + ")").text(baseDate.clone().add(d, "days").locale(locale).format("dd"));
    let meetingInPast = baseDate.clone().add(d, "days").isBefore(now);
    $("#day" + d).toggleClass("alert-secondary", meetingInPast).toggleClass("alert-primary", !meetingInPast).find("i").toggleClass("fa-history", meetingInPast).toggleClass("fa-spinner", !meetingInPast);
    if (baseDate.clone().add(d, "days").isSame(now)) $("#day" + d).addClass("today");
  }
}
function displayMusicRemaining() {
  let timeRemaining;
  if (prefs.enableMusicFadeOut && pendingMusicFadeOut.endTime >0) {
    let rightNow = dayjs();
    timeRemaining = (dayjs(pendingMusicFadeOut.endTime).isAfter(rightNow) ? dayjs(pendingMusicFadeOut.endTime).diff(rightNow) : 0);
  } else {
    timeRemaining = (isNaN($("#meetingMusic")[0].duration) ? 0 : ($("#meetingMusic")[0].duration - $("#meetingMusic")[0].currentTime) * 1000);
  }
  $("#musicRemaining").text(dayjs.duration(timeRemaining, "ms").format((timeRemaining >= 3600000 ? "HH:" : "") + "mm:ss"));
}
async function downloadIfRequired(file) {
  file.downloadRequired = true;
  file.localDir = file.pub ? path.join(paths.pubs, file.pub, file.issue) : path.join(paths.media, file.folder);
  file.localFile = path.join(file.localDir, file.pub ? path.basename(file.url) : file.safeName);
  if (fs.existsSync(file.localFile)) {
    file.localSize = fs.statSync(file.localFile).size;
    if (file.filesize == file.localSize) {
      file.downloadRequired = false;
    }
  }
  if (file.downloadRequired) {
    mkdirSync(file.localDir);
    file.contents = await get(file.url, true);
    fs.writeFileSync(file.localFile, new Buffer(file.contents));
  }
  if (path.extname(file.localFile) == ".jwpub") await new zipper((await new zipper(file.localFile).readFile("contents"))).extractAllTo(file.localDir);
}
async function executeStatement(db, statement) {
  var vals = await db.exec(statement)[0],
    valObj = [];
  if (vals) {
    for (var v = 0; v < vals.values.length; v++) {
      valObj[v] = {};
      for (var c = 0; c < vals.columns.length; c++) {
        valObj[v][vals.columns[c]] = vals.values[v][c];
      }
    }
  }
  return valObj;
}
async function ffmpegSetup() {
  if (!ffmpegIsSetup) {
    var osType = os.type();
    var targetOs;
    if (osType == "Windows_NT") {
      targetOs = "win-64";
    } else if (osType == "Darwin") {
      targetOs = "osx-64";
    } else {
      targetOs = "linux-64";
    }
    var ffmpegVersions = await get("https://api.github.com/repos/vot/ffbinaries-prebuilt/releases/latest");
    var ffmpegVersion = ffmpegVersions.assets.filter(a => a.name.includes(targetOs) && a.name.includes("ffmpeg"))[0];
    var ffmpegZipPath = path.join(paths.app, "ffmpeg", "zip", ffmpegVersion.name);
    if (!fs.existsSync(ffmpegZipPath) || fs.statSync(ffmpegZipPath).size !== ffmpegVersion.size) {
      cleanUp([path.join(paths.app, "ffmpeg", "zip")]);
      mkdirSync(path.join(paths.app, "ffmpeg", "zip"));
      var ffmpegZipFile = await get(ffmpegVersion.browser_download_url, true);
      fs.writeFileSync(ffmpegZipPath, new Buffer(ffmpegZipFile));
    }
    var zip = new zipper(ffmpegZipPath);
    var zipEntry = zip.getEntries().filter((x) => !x.entryName.includes("MACOSX"))[0];
    var ffmpegPath = path.join(path.join(paths.app, "ffmpeg", zipEntry.entryName));
    if (!fs.existsSync(ffmpegPath) || fs.statSync(ffmpegPath).size !== zipEntry.header.size) {
      zip.extractEntryTo(zipEntry.entryName, path.join(paths.app, "ffmpeg"), true, true);
    }
    try {
      fs.accessSync(ffmpegPath, fs.constants.X_OK);
    } catch (err) {
      fs.chmodSync(ffmpegPath, "777");
    }
    ffmpeg.setFfmpegPath(ffmpegPath);
    ffmpegIsSetup = true;
  }
}
async function get(url, isFile) {
  let response = null,
    payload = null;
  try {
    var options = {};
    if (isFile) {
      options.responseType = "arraybuffer";
      options.onDownloadProgress = function(progressEvent) {
        progressSet(progressEvent.loaded, progressEvent.total);
      };
    }
    if (url.includes("jw.org")) {
      options.adapter = require("axios/lib/adapters/http");
    }
    payload = await axios.get(url, options);
    response = payload.data;
  } catch (err) {
    console.error(url, err, payload);
  }
  return response;
}
async function getCongMedia() {
  perf("getCongMedia", "start");
  try {
    var congSpecificFolders = await webdavLs(path.posix.join(prefs.congServerDir, "Media"));
    totals.cong = {
      total: 0,
      current: 1
    };
    for (var congSpecificFolder of congSpecificFolders) {
      let remoteDir = await webdavLs(path.posix.join(prefs.congServerDir, "Media", congSpecificFolder.basename));
      for (let remoteFile of remoteDir) {
        var congSpecificFile = {
          "title": "Congregation-specific",
          media: [{
            safeName: remoteFile.basename,
            congSpecific: true,
            filesize: remoteFile.size,
            folder: congSpecificFolder.basename,
            url: remoteFile.filename
          }]
        };
        if (dayjs(congSpecificFolder.basename, "YYYY-MM-DD").isValid() && dayjs(congSpecificFolder.basename, "YYYY-MM-DD").isBetween(baseDate, baseDate.clone().add(6, "days"), null, "[]") && now.isSameOrBefore(dayjs(congSpecificFolder.basename, "YYYY-MM-DD"))) {
          if (!meetingMedia[congSpecificFolder.basename]) meetingMedia[congSpecificFolder.basename] = [];
          meetingMedia[congSpecificFolder.basename].push(congSpecificFile);
        } else if (!dayjs(congSpecificFolder.basename, "YYYY-MM-DD").isValid()) {
          for (var meeting of Object.keys(meetingMedia)) {
            const v8 = require("v8");
            var repeatFile = v8.deserialize(v8.serialize(congSpecificFile));
            repeatFile.media[0].recurring = true;
            repeatFile.media[0].folder = meeting;
            meetingMedia[meeting].push(repeatFile);
          }
        }
      }
    }
    console.log("%cHIDDEN MEDIA", "background-color: #fff3cd; color: #856404; padding: 0.5em 1em; font-weight: bold; font-size: 150%;");
    for (var hiddenFilesFolder of (await webdavLs(path.posix.join(prefs.congServerDir, "Hidden"))).filter(hiddenFilesFolder => dayjs(hiddenFilesFolder.basename, "YYYY-MM-DD").isValid() && dayjs(hiddenFilesFolder.basename, "YYYY-MM-DD").isBetween(baseDate, baseDate.clone().add(6, "days"), null, "[]") && now.isSameOrBefore(dayjs(hiddenFilesFolder.basename, "YYYY-MM-DD"))).sort((a, b) => (a.basename > b.basename) ? 1 : -1)) {
      console.log("%c[" + hiddenFilesFolder.basename + "]", "background-color: #fff3cd; color: #856404; padding: 0 1em; font-size: 125%;");
      for (var hiddenFile of await webdavLs(path.posix.join(prefs.congServerDir, "Hidden", hiddenFilesFolder.basename))) {
        var hiddenFileLogString = "background-color: #d6d8d9; color: #1b1e21; padding: 0 2em;";
        if (meetingMedia[hiddenFilesFolder.basename]) {
          meetingMedia[hiddenFilesFolder.basename].filter(part => part.media.filter(mediaItem => mediaItem.safeName == hiddenFile.basename).map(function (mediaItem) {
            mediaItem.hidden = true;
            hiddenFileLogString = "background-color: #fff3cd; color: #856404; padding: 0 2em;";
          }));
        }
        console.log("%c" + hiddenFile.basename, hiddenFileLogString);
      }
    }
  } catch (err) {
    console.error(err);
    $("#specificCong").addClass("alert-danger").find("i").addClass("fa-times-circle");
  }
  perf("getCongMedia", "stop");
}
async function getDbFromJwpub(pub, issue, localpath) {
  try {
    var SQL = await sqljs();
    if (localpath) {
      var jwpubContents = await new zipper(localpath).readFile("contents");
      var jwpubDbEntry = (await new zipper(jwpubContents).getEntries()).filter(entry => path.extname(entry.name) == ".db")[0];
      var tempDb = new SQL.Database(await new zipper(jwpubContents).readFile(jwpubDbEntry.entryName));
      var jwpubInfo = (await executeStatement(tempDb, "SELECT UndatedSymbol, IssueTagNumber FROM Publication"))[0];
      pub = jwpubInfo.UndatedSymbol;
      issue = jwpubInfo.IssueTagNumber;
      if (!jwpubDbs[pub]) jwpubDbs[pub] = {};
      jwpubDbs[pub][issue] = tempDb;
    } else {
      if (!jwpubDbs[pub]) jwpubDbs[pub] = {};
      if (!jwpubDbs[pub][issue]) {
        var jwpub = (await getMediaLinks(pub, null, issue, "JWPUB"))[0];
        jwpub.pub = pub;
        jwpub.issue = issue;
        await downloadIfRequired(jwpub);
        jwpubDbs[pub][issue] = new SQL.Database(fs.readFileSync(glob.sync(path.join(paths.pubs, jwpub.pub, jwpub.issue, "*.db"))[0]));
      }
    }
    return jwpubDbs[pub][issue];
  } catch (err) {
    console.error(err);
  }
}
async function getDocumentExtract(db, docId) {
  var statement = "SELECT DocumentExtract.BeginParagraphOrdinal,DocumentExtract.EndParagraphOrdinal,DocumentExtract.DocumentId,Extract.RefMepsDocumentId,Extract.RefPublicationId,Extract.RefMepsDocumentId,UndatedSymbol,IssueTagNumber,Extract.RefBeginParagraphOrdinal,Extract.RefEndParagraphOrdinal FROM DocumentExtract INNER JOIN Extract ON DocumentExtract.ExtractId = Extract.ExtractId INNER JOIN RefPublication ON Extract.RefPublicationId = RefPublication.RefPublicationId INNER JOIN Document ON DocumentExtract.DocumentId = Document.DocumentId WHERE DocumentExtract.DocumentId = " + docId + " AND NOT UndatedSymbol = 'sjj' AND NOT UndatedSymbol = 'mwbr' AND RefBeginParagraphOrdinal IS NOT NULL ORDER BY DocumentExtract.BeginParagraphOrdinal";
  var extractItems = await executeStatement(db, statement);
  var extractMultimediaItems = [];
  for (var extractItem of extractItems) {
    var extractDb = await getDbFromJwpub(extractItem.UndatedSymbol, extractItem.IssueTagNumber);
    if (extractDb) {
      var extractMediaFiles = await getDocumentMultimedia(extractDb, null, extractItem.RefMepsDocumentId);
      extractMultimediaItems = extractMultimediaItems.concat(extractMediaFiles.filter(extractMediaFile => extractItem.RefBeginParagraphOrdinal <= extractMediaFile.BeginParagraphOrdinal && extractMediaFile.BeginParagraphOrdinal <= extractItem.RefEndParagraphOrdinal).map(extractMediaFile => {
        extractMediaFile.BeginParagraphOrdinal = extractItem.BeginParagraphOrdinal;
        return extractMediaFile;
      }));
    }
  }
  return extractMultimediaItems;
}
async function getDocumentMultimedia(db, destDocId, destMepsId, memOnly) {
  var tableMultimedia = ((await executeStatement(db, "SELECT * FROM sqlite_master WHERE type='table' AND name='DocumentMultimedia'")).length === 0 ? "Multimedia" : "DocumentMultimedia");
  var suppressZoomExists = (await executeStatement(db, "SELECT COUNT(*) AS CNTREC FROM pragma_table_info('Multimedia') WHERE name='SuppressZoom'")).map(function(item) {
    return (item.CNTREC > 0 ? true : false);
  })[0];
  var statement = "SELECT " + tableMultimedia + ".DocumentId, " + tableMultimedia + ".MultimediaId, " + (tableMultimedia == "DocumentMultimedia" ? tableMultimedia + ".BeginParagraphOrdinal, " + tableMultimedia + ".EndParagraphOrdinal, Multimedia.KeySymbol, Multimedia.MultimediaId," + (suppressZoomExists ? " Multimedia.SuppressZoom," : "") + " Multimedia.MepsDocumentId AS MultiMeps, Document.MepsDocumentId, Multimedia.Track, Multimedia.IssueTagNumber, " : "Multimedia.CategoryType, ") + "Multimedia.MimeType, Multimedia.FilePath, Multimedia.Label, Multimedia.Caption, Multimedia.CategoryType FROM " + tableMultimedia + (tableMultimedia == "DocumentMultimedia" ? " INNER JOIN Multimedia ON Multimedia.MultimediaId = " + tableMultimedia + ".MultimediaId" : "") + " INNER JOIN Document ON " + tableMultimedia + ".DocumentId = Document.DocumentId WHERE " + (destDocId || destDocId === 0 ? tableMultimedia + ".DocumentId = " + destDocId : "Document.MepsDocumentId = " + destMepsId) + " AND (((Multimedia.MimeType LIKE '%video%' OR Multimedia.MimeType LIKE '%audio%')) OR (Multimedia.MimeType LIKE '%image%' AND Multimedia.CategoryType <> 9 AND Multimedia.CategoryType <> 10" + (suppressZoomExists ? " AND Multimedia.SuppressZoom <> 1" : "") + "))" + (tableMultimedia == "DocumentMultimedia" ? " ORDER BY BeginParagraphOrdinal" : "");
  var multimedia = await executeStatement(db, statement);
  var multimediaItems = [];
  for (var multimediaItem of multimedia) {
    try {
      if ((multimediaItem.MimeType.includes("audio") || multimediaItem.MimeType.includes("video"))) {
        var json = {
          queryInfo: multimediaItem,
          BeginParagraphOrdinal: multimediaItem.BeginParagraphOrdinal
        };
        Object.assign(json, (await getMediaLinks(multimediaItem.KeySymbol, multimediaItem.Track, multimediaItem.IssueTagNumber, null, multimediaItem.MultiMeps))[0]);
        multimediaItems.push(json);
      } else {
        if (multimediaItem.KeySymbol == null) {
          multimediaItem.KeySymbol = (await executeStatement(db, "SELECT UniqueEnglishSymbol FROM Publication"))[0].UniqueEnglishSymbol.replace(/[0-9]*/g, "");
          multimediaItem.IssueTagNumber = (await executeStatement(db, "SELECT IssueTagNumber FROM Publication"))[0].IssueTagNumber;
          if (!memOnly) multimediaItem.LocalPath = path.join(paths.pubs, multimediaItem.KeySymbol, multimediaItem.IssueTagNumber, multimediaItem.FilePath);
        }
        multimediaItem.FileName = (multimediaItem.Caption.length > multimediaItem.Label.length ? multimediaItem.Caption : multimediaItem.Label);
        var picture = {
          BeginParagraphOrdinal: multimediaItem.BeginParagraphOrdinal,
          title: multimediaItem.FileName,
          queryInfo: multimediaItem
        };
        if (!memOnly) {
          picture.filepath = multimediaItem.LocalPath;
          picture.filesize = fs.statSync(multimediaItem.LocalPath).size;
        }
        multimediaItems.push(picture);
      }
    } catch (err) {
      console.error(err);
    }
  }
  return multimediaItems;
}
async function getInitialData() {
  await getLanguages();
  await getTranslations();
  await updateSongs();
  validateConfig();
  $("#version").text("v" + remote.app.getVersion());
  await webdavSetup();
  $("#day" + prefs.mwDay + ", #day" + prefs.weDay).addClass("meeting");
  if (os.platform() == "linux") $(".notLinux").prop("disabled", true);
  if (prefs.autoStartSync && validateConfig()) {
    var cancelSync = false;
    $("#btnCancelSync").on("click", function() {
      cancelSync = true;
      $("#btnCancelSync").addClass("text-danger fa-stop-circle").removeClass("text-warning fa-pause-circle");
    });
    $("#overlayStarting").fadeIn(animationDuration, () => {
      $("#overlayPleaseWait").stop().hide();
    }).delay(3000).fadeOut(animationDuration, () => {
      if (!cancelSync) $("#mediaSync").click();
    });
  } else {
    $("#overlayPleaseWait").stop().fadeOut(animationDuration);
  }
  $("#baseDate button, #baseDate .dropdown-item:eq(0)").text(baseDate.format("YYYY-MM-DD") + " - " + baseDate.clone().add(6, "days").format("YYYY-MM-DD")).val(baseDate.format("YYYY-MM-DD"));
  $("#baseDate .dropdown-item:eq(0)").addClass("active");
  for (var a = 1; a <= 4; a++) {
    $("#baseDate .dropdown-menu").append("<button class='dropdown-item' value='" + baseDate.clone().add(a, "week").format("YYYY-MM-DD") + "'>" + baseDate.clone().add(a, "week").format("YYYY-MM-DD") + " - " + baseDate.clone().add(a, "week").add(6, "days").format("YYYY-MM-DD") + "</button>");
  }
}
async function getLanguages() {
  if ((!fs.existsSync(paths.langs)) || (!prefs.langUpdatedLast) || dayjs(prefs.langUpdatedLast).isBefore(now.subtract(3, "months")) || dayjs(prefs.langUpdatedLast).isBefore(dayjs("2021-02-04"))) {
    var jwLangs = await get("https://www.jw.org/en/languages/");
    let cleanedJwLangs = jwLangs.languages.filter(lang => lang.hasWebContent).map(lang => ({
      name: lang.vernacularName + " (" + lang.name + ")",
      langcode: lang.langcode,
      symbol: lang.symbol
    }));
    fs.writeFileSync(paths.langs, JSON.stringify(cleanedJwLangs, null, 2));
    prefs.langUpdatedLast = dayjs();
    fs.writeFileSync(paths.prefs, JSON.stringify(Object.keys(prefs).sort().reduce((acc, key) => ({...acc, [key]: prefs[key]}), {}), null, 2));
    jsonLangs = cleanedJwLangs;
  } else {
    jsonLangs = JSON.parse(fs.readFileSync(paths.langs));
  }
  dateFormatter();
  for (var lang of jsonLangs) {
    $("#lang").append($("<option>", {
      value: lang.langcode,
      text: lang.name
    }));
  }
  $("#lang").val(prefs.lang);
  $("#lang").select2();
}
async function getMediaLinks(pub, track, issue, format, docId) {
  let mediaFiles = [];
  try {
    let url = "https://b.jw-cdn.org/apis/pub-media/GETPUBMEDIALINKS?output=json" + (docId ? "&docid=" + docId : "&pub=" + pub + (track ? "&track=" + track : "") + (issue ? "&issue=" + issue : "")) + (format ? "&fileformat=" + format : "") + "&langwritten=" + prefs.lang;
    let result = await get(url);
    if (result) {
      let mediaFileCategories = Object.values(result.files)[0];
      for (var mediaFileItem of mediaFileCategories[("MP4" in mediaFileCategories ? "MP4" : result.fileformat[0])].reverse()) {
        let videoRes = mediaFileItem.label.replace(/\D/g, "");
        if ((videoRes !== 0 && videoRes > prefs.maxRes.replace(/\D/g, "")) || mediaFiles.filter(mediaFile => mediaFile.title == mediaFileItem.title).length > 0) {
          continue;
        } else {
          mediaFiles.push({
            title: mediaFileItem.title,
            filesize: mediaFileItem.filesize,
            url: mediaFileItem.file.url,
            duration: mediaFileItem.duration
          });
        }
      }
    }
  } catch(err) {
    console.error(err);
  }
  return mediaFiles;
}
async function getMwMediaFromDb() {
  var mwDate = baseDate.clone().add(prefs.mwDay, "days").format("YYYY-MM-DD");
  if (now.isSameOrBefore(dayjs(mwDate))) {
    if (!dryrun) $("#day" + prefs.mwDay).addClass("alert-warning").removeClass("alert-primary").find("i").removeClass("fa-check-circle").addClass("fa-spinner fa-pulse");
    try {
      var issue = baseDate.format("YYYYMM") + "00";
      if (parseInt(baseDate.format("M")) % 2 === 0) issue = baseDate.clone().subtract(1, "months").format("YYYYMM") + "00";
      var db = await getDbFromJwpub("mwb", issue);
      try {
        var docId = (await executeStatement(db, "SELECT DocumentId FROM DatedText WHERE FirstDateOffset = " + baseDate.format("YYYYMMDD") + ""))[0].DocumentId;
      } catch {
        throw("No MW meeting date!");
      }
      var videos = await getDocumentMultimedia(db, docId);
      videos.map(video => {
        addMediaItemToPart(mwDate, video.BeginParagraphOrdinal, video);
      });
      var extracted = await getDocumentExtract(db, docId);
      extracted.map(extract => {
        addMediaItemToPart(mwDate, extract.BeginParagraphOrdinal, extract);
      });
      var internalRefs = await executeStatement(db, "SELECT DocumentInternalLink.DocumentId AS SourceDocumentId, DocumentInternalLink.BeginParagraphOrdinal, Document.DocumentId FROM DocumentInternalLink INNER JOIN InternalLink ON DocumentInternalLink.InternalLinkId = InternalLink.InternalLinkId INNER JOIN Document ON InternalLink.MepsDocumentId = Document.MepsDocumentId WHERE DocumentInternalLink.DocumentId = " + docId + " AND Document.Class <> 94");
      for (var internalRef of internalRefs) {
        var internalRefMediaFiles = await getDocumentMultimedia(db, internalRef.DocumentId);
        internalRefMediaFiles.map(internalRefMediaFile => {
          addMediaItemToPart(mwDate, internalRef.BeginParagraphOrdinal, internalRefMediaFile);
        });
      }
      if (!dryrun) $("#day" + prefs.mwDay).addClass("alert-success").find("i").addClass("fa-check-circle");
    } catch(err) {
      console.error(err);
      $("#day" + prefs.mwDay).addClass("alert-danger").find("i").addClass("fa-times-circle");
    }
    if (!dryrun) $("#day" + prefs.mwDay).removeClass("alert-warning").find("i").removeClass("fa-spinner fa-pulse");
  }
}
function getPrefix() {
  prefix = $("#enterPrefix input").map(function() {
    return $(this).val();
  }).toArray().join("").trim();
  for (var a0 = 0; a0 <= 4; a0++) {
    if ($("#enterPrefix-" + a0).val().length > 0) {
      for (var a1 = a0 + 1; a1 <= 5; a1++) {
        $("#enterPrefix-" + a1).prop("disabled", false);
      }
    } else {
      for (var a2 = a0 + 1; a2 <= 5; a2++) {
        $("#enterPrefix-" + a2).prop("disabled", true);
        $("#enterPrefix-" + a2).val("");
      }
    }
  }
  $(".enterPrefixInput:not(:disabled)").fadeTo(animationDuration, 1);
  $(".enterPrefixInput:disabled").fadeTo(animationDuration, 0);
  $("#enterPrefix-" + prefix.length).focus();
  if (prefix.length % 2) prefix = prefix + 0;
  if (prefix.length > 0) prefix = prefix.match(/.{1,2}/g).join("-");
}
async function getTranslations() {
  var localeLang = (jsonLangs.filter(el => el.langcode == prefs.lang))[0];
  i18n.configure({
    directory: path.join(__dirname, "locales"),
    defaultLocale: "en",
    updateFiles: false,
    retryInDefaultLocale: true
  });
  if (localeLang) i18n.setLocale(localeLang.symbol);
  $(".i18n").each(function() {
    $(this).html(i18n.__($(this).data("i18n-string")));
  });
}
async function getWeMediaFromDb() {
  var weDate = baseDate.clone().add(prefs.weDay, "days").format("YYYY-MM-DD");
  if (now.isSameOrBefore(dayjs(weDate))) {
    if (!dryrun) $("#day" + prefs.weDay).addClass("alert-warning").removeClass("alert-primary").find("i").removeClass("fa-check-circle").addClass("fa-spinner fa-pulse");
    try {
      var issue = baseDate.clone().subtract(8, "weeks").format("YYYYMM") + "00";
      var db = await getDbFromJwpub("w", issue);
      var weekNumber = (await executeStatement(db, "SELECT FirstDateOffset FROM DatedText")).findIndex(weekItem => dayjs(weekItem.FirstDateOffset.toString(), "YYYYMMDD").isBetween(baseDate, baseDate.clone().add(6, "days"), null, "[]"));
      try {
        var docId = (await executeStatement(db, "SELECT Document.DocumentId FROM Document WHERE Document.Class=40 LIMIT 1 OFFSET " + weekNumber))[0].DocumentId;
      } catch {
        throw("No WE meeting date!");
      }
      var qryLocalMedia = await executeStatement(db, "SELECT DocumentMultimedia.MultimediaId,Document.DocumentId,Multimedia.CategoryType,Multimedia.KeySymbol,Multimedia.Track,Multimedia.IssueTagNumber,Multimedia.MimeType,DocumentMultimedia.BeginParagraphOrdinal,Multimedia.FilePath,Label,Caption FROM DocumentMultimedia INNER JOIN Document ON Document.DocumentId = DocumentMultimedia.DocumentId INNER JOIN Multimedia ON DocumentMultimedia.MultimediaId = Multimedia.MultimediaId WHERE Document.DocumentId = " + docId + " AND Multimedia.CategoryType <> 9");
      for (var picture of qryLocalMedia) {
        var LocalPath = path.join(paths.pubs, "w", issue, picture.FilePath);
        var FileName = (picture.Caption.length > picture.Label.length ? picture.Caption : picture.Label);
        var pictureObj = {
          title: FileName,
          filepath: LocalPath,
          filesize: fs.statSync(LocalPath).size,
          queryInfo: picture
        };
        addMediaItemToPart(weDate, picture.BeginParagraphOrdinal, pictureObj);
      }
      var qrySongs = await executeStatement(db, "SELECT * FROM Multimedia INNER JOIN DocumentMultimedia ON Multimedia.MultimediaId = DocumentMultimedia.MultimediaId WHERE DataType = 2 ORDER BY BeginParagraphOrdinal LIMIT 2 OFFSET " + weekNumber * 2);
      for (var song = 0; song < qrySongs.length; song++) {
        var songObj = (await getMediaLinks(qrySongs[song].KeySymbol, qrySongs[song].Track))[0];
        songObj.queryInfo = qrySongs[song];
        addMediaItemToPart(weDate, song * 1000, songObj);
      }
      if (!dryrun) $("#day" + prefs.weDay).addClass("alert-success").find("i").addClass("fa-check-circle");
    } catch(err) {
      console.error(err);
      $("#day" + prefs.weDay).addClass("alert-danger").find("i").addClass("fa-times-circle");
    }
    if (!dryrun) $("#day" + prefs.weDay).removeClass("alert-warning").find("i").removeClass("fa-spinner fa-pulse");
  }
}
async function isReachable(hostname, port) {
  let returned = 500;
  await axios.head("https://" + hostname + (port ? ":" + port : ""), {
    adapter: require("axios/lib/adapters/http")
  })
    .then(function (answer) {
      returned = (answer.status ? answer.status : answer);
    })
    .catch(async function (error) {
      returned = (error.response && error.response.status ? error.response.status : error);
    });
  let reachable = ((returned >= 200 && returned < 400) || returned === 401 || returned === true);
  return reachable;
}
function mkdirSync(dirPath) {
  try {
    fs.mkdirSync(dirPath, {
      recursive: true
    });
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
  }
}
async function mp4Convert() {
  perf("mp4Convert", "start");
  $("#statusIcon").addClass("fa-microchip").removeClass("fa-photo-video");
  $("#mp4Convert").addClass("alert-warning").removeClass("alert-primary").find("i").removeClass("fa-check-circle").addClass("fa-spinner fa-pulse");
  await convertUnusableFiles();
  var filesToProcess = glob.sync(path.join(paths.media, "*", "*"), {
    ignore: path.join(paths.media, "*", "*.mp4")
  });
  totals.mp4Convert = {
    total: filesToProcess.length,
    current: 1
  };
  for (var mediaFile of filesToProcess) {
    progressSet(totals.mp4Convert.current, totals.mp4Convert.total, "mp4Convert");
    await createVideoSync(path.basename(path.dirname(mediaFile)), path.basename(mediaFile));
    fs.rmSync(mediaFile);
    totals.mp4Convert.current++;
    progressSet(totals.mp4Convert.current, totals.mp4Convert.total, "mp4Convert");
  }
  $("#mp4Convert").removeClass("alert-warning").addClass("alert-success").find("i").addClass("fa-check-circle").removeClass("fa-spinner fa-pulse");
  $("#statusIcon").addClass("fa-photo-video").removeClass("fa-microchip");
  perf("mp4Convert", "stop");
}
function perf(func, op) {
  if (!perfStats[func]) perfStats[func] = {};
  perfStats[func][op] = performance.now();
}
function perfPrint() {
  console.log("\n%cPERFORMANCE INFO", "background-color: #e2e3e5; color: #41464b; padding: 0.5em 1em; font-weight: bold; font-size: 125%;");
  for (var perfItem of Object.entries(perfStats).sort((a, b) => a[1].stop - b[1].stop)) {
    console.log("%c[" + perfItem[0] + "] " + (perfItem[1].stop - perfItem[1].start).toFixed(1) + "ms", "background-color: #e2e3e5; color: #41464b; padding: 0 1em;");
  }
}
function prefsInitialize() {
  for (var pref of ["lang", "mwDay", "weDay", "autoStartSync", "autoRunAtBoot", "autoQuitWhenDone", "outputPath", "betaMp4Gen", "congServer", "congServerPort", "congServerUser", "congServerPass", "openFolderWhenDone", "additionalMediaPrompt", "maxRes", "enableMusicButton", "enableMusicFadeOut", "musicFadeOutTime", "musicFadeOutType", "mwStartTime", "weStartTime"]) {
    if (!(Object.keys(prefs).includes(pref)) || !prefs[pref]) prefs[pref] = null;
  }
  for (let field of ["lang", "outputPath", "congServer", "congServerUser", "congServerPass", "congServerPort", "congServerDir", "musicFadeOutTime", "mwStartTime", "weStartTime"]) {
    $("#" + field).val(prefs[field]).change();
  }
  for (let timeField of ["mwStartTime", "weStartTime"]) {
    $(".timePicker").filter("[data-target='" + timeField + "']").val($("#" + timeField).val());
  }
  for (let dtPicker of datepickers) {
    dtPicker.setDate($(dtPicker.element).val());
  }
  for (let checkbox of ["autoStartSync", "autoRunAtBoot", "betaMp4Gen", "autoQuitWhenDone", "openFolderWhenDone", "additionalMediaPrompt", "enableMusicButton", "enableMusicFadeOut"]) {
    $("#" + checkbox).prop("checked", prefs[checkbox]).change();
  }
  for (let radioSel of ["mwDay", "weDay", "maxRes", "musicFadeOutType"]) {
    $("#" + radioSel + " input[value=" + prefs[radioSel] + "]").prop("checked", true).parent().addClass("active");
  }
}
function progressSet(current, total, blockId) {
  if (!dryrun || !blockId) {
    var percent = current / total * 100;
    if (percent > 100 || (!blockId && percent === 100)) percent = 0;
    blockId = (blockId ? "#" + blockId + " .progress-bar" : "#globalProgress");
    $(blockId).width(percent + "%");
  }
}
function removeEventListeners() {
  document.removeEventListener("drop", dropHandler);
  document.removeEventListener("dragover", dragoverHandler);
  document.removeEventListener("dragenter", dragenterHandler);
  document.removeEventListener("dragleave", dragleaveHandler);
}
function sanitizeFilename(filename) {
  filename = filename.match(/(\p{Script=Cyrillic}*\p{Script=Latin}*[-. 0-9_]*)/ug)
    .join("")
    .replace(/[?!"»“”‘’«()\\[\]№—$]*/g, "")
    .replace(/[;:,|/]+/g, " - ")
    .replace(/ +/g, " ")
    .replace(/\.+/g, ".")
    .replace(/\r?\n/g, " - ");
  var bytes = Buffer.byteLength(filename, "utf8");
  var toolong = 200;
  if (bytes > toolong) {
    var fe = filename.split(".").pop();
    var chunks = filename.split(" - ");
    while (bytes > toolong) {
      if (chunks.length > 2) {
        chunks.pop();
        filename = chunks.join(" - ");
      } else {
        filename = filename.substring(0, 90);
        chunks = [filename];
      }
      bytes = Buffer.byteLength(filename + "." + fe, "utf8");
    }
    filename = chunks.join(" - ") + "." + fe;
    bytes = Buffer.byteLength(filename, "utf8");
  }
  filename = filename.trim();
  filename = path.basename(filename, path.extname(filename)) + path.extname(filename).toLowerCase();
  return filename;
}
function setVars() {
  perf("setVars", "start");
  try {
    meetingMedia = {};
    jwpubDbs = {};
    paths.output = path.join(prefs.outputPath);
    mkdirSync(paths.output);
    paths.lang = path.join(paths.output, prefs.lang);
    mkdirSync(paths.lang);
    paths.media = path.join(paths.lang, "Media");
    mkdirSync(paths.media);
    paths.pubs = path.join(paths.app, "Publications", prefs.lang);
  } catch (err) {
    console.error(err);
  }
  perf("setVars", "stop");
}
async function startMediaSync() {
  perf("total", "start");
  $("#statusIcon").addClass("text-primary").removeClass("text-muted");
  stayAlive = false;
  $("#btn-settings" + (prefs.congServer && prefs.congServer.length > 0 ? ", #btn-upload" : "")).fadeTo(animationDuration, 0);
  await setVars();
  if (!dryrun) await cleanUp([paths.media]);
  perf("getJwOrgMedia", "start");
  await getMwMediaFromDb();
  await getWeMediaFromDb();
  //await getMwMediaFromWol();
  //await getWeMediaFromWol();
  perf("getJwOrgMedia", "stop");
  createMediaNames();
  if (webdavIsAGo) await getCongMedia();
  if (!dryrun) {
    await syncJwOrgMedia();
    if (webdavIsAGo) await syncCongMedia();
    if (prefs.additionalMediaPrompt) await additionalMedia();
    if (prefs.betaMp4Gen) await mp4Convert();
    if (prefs.openFolderWhenDone) shell.openPath(paths.media);
  }
  $("#btn-settings" + (prefs.congServer && prefs.congServer.length > 0 ? ", #btn-upload" : "")).fadeTo(animationDuration, 1);
  setTimeout(() => {
    $(".alertIndicators").addClass("alert-primary").removeClass("alert-success");
    $("#statusIcon").addClass("text-muted").removeClass("text-primary");
  }, 2000);
  perf("total", "stop");
  perfPrint();
}
async function syncCongMedia() {
  perf("syncCongMedia", "start");
  $("#statusIcon").addClass("fa-cloud").removeClass("fa-photo-video");
  $("#specificCong").addClass("alert-warning").removeClass("alert-primary").find("i").removeClass("fa-check-circle").addClass("fa-spinner fa-pulse");
  try {
    totals.cong = {
      total: 0,
      current: 1
    };
    for (let parts of Object.values(meetingMedia)) {
      for (let part of parts.filter(part => part.media.filter(mediaItem => mediaItem.congSpecific && !mediaItem.hidden).length > 0)) {
        totals.cong.total = totals.cong.total + part.media.filter(mediaItem => mediaItem.congSpecific && !mediaItem.hidden).length;
      }
    }
    console.log("%cCONGREGATION MEDIA", "background-color: #d1ecf1; color: #0c5460; padding: 0.5em 1em; font-weight: bold; font-size: 150%;");
    for (let [meeting, parts] of Object.entries(meetingMedia)) {
      console.log("%c[" + meeting + "]", "background-color: #d1ecf1; color: #0c5460; padding: 0 1em; font-size: 125%;");
      for (let part of parts) {
        for (var mediaItem of part.media.filter(mediaItem => mediaItem.congSpecific && !mediaItem.hidden)) {
          progressSet(totals.cong.current, totals.cong.total, "specificCong");
          await webdavGet(mediaItem);
          console.log("%c" + mediaItem.safeName, "background-color: #d1ecf1; color: #0c5460; padding: 0 2em;");
          totals.cong.current++;
          progressSet(totals.cong.current, totals.cong.total, "specificCong");
        }
      }
    }
  } catch (err) {
    console.error(err);
    $("#specificCong").addClass("alert-danger").find("i").addClass("fa-times-circle");
  }
  $("#specificCong").removeClass("alert-warning").addClass("alert-success").find("i").addClass("fa-check-circle").removeClass("fa-spinner fa-pulse");
  $("#statusIcon").addClass("fa-photo-video").removeClass("fa-cloud");
  perf("syncCongMedia", "stop");
}
async function syncJwOrgMedia() {
  perf("syncJwOrgMedia", "start");
  $("#syncJwOrgMedia").addClass("alert-warning").removeClass("alert-primary").find("i").removeClass("fa-check-circle").addClass("fa-spinner fa-pulse");
  totals.jw = {
    total: 0,
    current: 1
  };
  for (let meeting of Object.values(meetingMedia)) {
    for (let part of meeting) {
      totals.jw.total = totals.jw.total + part.media.filter(mediaItem => !mediaItem.congSpecific).length;
    }
  }
  console.log("%cJW.org MEDIA", "background-color: #cce5ff; color: #004085; padding: 0.5em 1em; font-weight: bold; font-size: 150%;");
  for (var h = 0; h < Object.values(meetingMedia).length; h++) { // meetings
    console.log("%c[" + Object.keys(meetingMedia)[h] + "]", "background-color: #cce5ff; color: #004085; padding: 0 1em; font-size: 125%;");
    var meeting = Object.values(meetingMedia)[h];
    for (var i = 0; i < meeting.length; i++) { // parts
      var partMedia = meeting[i].media.filter(mediaItem => !mediaItem.congSpecific);
      for (var j = 0; j < partMedia.length; j++) { // media
        progressSet(totals.jw.current, totals.jw.total, "syncJwOrgMedia");
        if (!partMedia[j].hidden && !partMedia[j].congSpecific && !dryrun) {
          console.log("%c" + partMedia[j].safeName, "background-color: #cce5ff; color: #004085; padding: 0 2em;");
          if (partMedia[j].url) {
            await downloadIfRequired(partMedia[j]);
          } else {
            var destFile = path.join(paths.media, partMedia[j].folder, partMedia[j].safeName);
            if (!fs.existsSync(destFile) || fs.statSync(destFile).size !== partMedia[j].filesize) fs.copyFileSync(partMedia[j].filepath, destFile);
          }
        }
        totals.jw.current++;
        progressSet(totals.jw.current, totals.jw.total, "syncJwOrgMedia");
      }
    }
  }
  $("#syncJwOrgMedia").removeClass("alert-warning").addClass("alert-success").find("i").addClass("fa-check-circle").removeClass("fa-spinner fa-pulse");
  $("#statusIcon").addClass("fa-photo-video").removeClass("fa-microchip");
  perf("syncJwOrgMedia", "stop");
}
function toggleScreen(screen, forceShow) {
  var visible = $("#" + screen).is(":visible");
  if (!visible || forceShow) {
    $("#" + screen).slideDown(animationDuration);
  } else {
    $("#" + screen).slideUp(animationDuration);
  }
}
function updateCleanup() {
  try { // do some housecleaning after version updates
    var lastRunVersion = (fs.existsSync(paths.lastRunVersion) ? fs.readFileSync(paths.lastRunVersion, "utf8") : 0);
    setVars();
  } catch(err) {
    console.error(err);
  } finally {
    if (lastRunVersion !== remote.app.getVersion()) {
      cleanUp([paths.lang, paths.pubs]);
      fs.writeFileSync(paths.lastRunVersion, remote.app.getVersion());
    }
  }
}
async function updateSongs() {
  try {
    $("#songPicker").empty();
    for (let sjj of (await getMediaLinks("sjjm", null, null, "MP4")).reverse()) {
      $("#songPicker").append($("<option>", {
        value: sjj.url,
        text: sjj.title
      }));
    }
    $("#songPicker").on("change", function() {
      if ($(this).val()) $("#fileToUpload").val($(this).val()).change();
    });
  } catch (err) {
    console.error(err);
    $("label[for=typeSong]").removeClass("active").addClass("disabled");
    $("label[for=typeFile]").click().addClass("active");
  }
}
function validateConfig() {
  $("#lang").next(".select2").find(".select2-selection").removeClass("invalid");
  $("#mwDay, #weDay, #outputPath, .timePicker").removeClass("invalid is-invalid");
  $("#overlaySettings .btn-outline-danger").addClass("btn-outline-primary").removeClass("btn-outline-danger");
  $("#overlaySettings label.text-danger").removeClass("text-danger");
  let configIsValid = true;
  if (!prefs.lang) {
    $("#lang").next(".select2").find(".select2-selection").addClass("invalid");
    configIsValid = false;
  }
  for (var elem of ["mwDay", "weDay", "maxRes"]) {
    if (!prefs[elem]) {
      $("#" + elem + " .btn-outline-primary").addClass("btn-outline-danger").removeClass("btn-outline-primary");
      configIsValid = false;
    }
  }
  if (prefs.outputPath === "false" || !fs.existsSync(prefs.outputPath)) $("#outputPath").val("");
  let mandatoryFields = ["outputPath"];
  if (prefs.enableMusicFadeOut && prefs.musicFadeOutType === "smart") mandatoryFields.push("mwStartTime", "weStartTime");
  for (var setting of mandatoryFields) {
    if (!prefs[setting]) {
      $("#" + setting + ":visible, .timePicker[data-target='" + setting + "']").addClass("is-invalid");
      configIsValid = false;
    }
  }
  if (!prefs.musicFadeOutTime) $("#musicFadeOutTime").val(5).change();
  $("#musicFadeOutType label span").text(prefs.musicFadeOutTime);
  $(".relatedToFadeOut, #enableMusicFadeOut").prop("disabled", !prefs.enableMusicButton);
  if (prefs.enableMusicButton) $(".relatedToFadeOut").prop("disabled", !prefs.enableMusicFadeOut);
  if (prefs.enableMusicButton && prefs.enableMusicFadeOut && !prefs.musicFadeOutType) $("label[for=musicFadeOutSmart]").click();
  $("#mp4Convert").toggleClass("d-flex", prefs.betaMp4Gen);
  $("#btnMeetingMusic").toggle(prefs.enableMusicButton && $("#btnStopMeetingMusic:visible").length === 0);
  $("#overlaySettings .invalid, #overlaySettings .is-invalid, #overlaySettings .btn-outline-danger").each(function() {
    $(this).closest("div.flex-row").find("label:nth-child(1)").addClass("text-danger");
  });
  $(".btn-settings").toggleClass("btn-dark", configIsValid).toggleClass("btn-danger", !configIsValid);
  $("#settingsIcon").toggleClass("text-muted", configIsValid).toggleClass("text-danger", !configIsValid);
  $("#mediaSync, .btn-settings").prop("disabled", !configIsValid);
  if (!configIsValid) toggleScreen("overlaySettings", true);
  return configIsValid;
}
async function webdavGet(file) {
  let localFile = path.join(paths.media, file.folder, file.safeName);
  if (fs.existsSync(localFile) ? !(file.filesize == fs.statSync(localFile).size) : true) {
    if (!fs.existsSync(path.join(paths.media, file.folder))) fs.mkdirSync(path.join(paths.media, file.folder));
    file.contents = await webdavClient.getFileContents(file.url);
    fs.writeFileSync(localFile, new Buffer(file.contents));
  }
}
async function webdavLs(dir, force) {
  try {
    if (webdavIsAGo || force) {
      if (await webdavClient.exists(dir) === false) {
        await webdavClient.createDirectory(dir, {
          recursive: true
        });
      }
      return (await webdavClient.getDirectoryContents(dir)).sort((a, b) => a.basename.localeCompare(b.basename));
    }
  } catch (err) {
    console.error(err);
    throw(err);
  }
}
async function webdavPut(file, destFolder, destName) {
  try {
    if (webdavIsAGo && file && destFolder && destName) {
      if (await webdavClient.exists(destFolder) === false) {
        await webdavClient.createDirectory(destFolder, {
          recursive: true
        });
      }
      await webdavClient.putFileContents(path.posix.join(destFolder, (await sanitizeFilename(destName))), file, {
        contentLength: false,
        onUploadProgress: progressEvent => {
          progressSet(progressEvent.loaded, progressEvent.total);
        }
      });
    }
  } catch (err) {
    console.error(err);
  }
}
async function webdavRm(path) {
  try {
    if (webdavIsAGo && path && await webdavClient.exists(path)) await webdavClient.deleteFile(path);
  } catch (err) {
    console.error(err);
  }
}
async function webdavSetup() {
  $(".webdavHost, .webdavCreds, #congServerDir").removeClass("is-valid is-invalid");
  if (prefs.congServer && prefs.congServer.length > 0) {
    $(".webdavHost").addClass("is-invalid");
    let congServerHeartbeat = await isReachable(prefs.congServer, prefs.congServerPort);
    if (prefs.congServerPort && congServerHeartbeat) {
      $("#webdavStatus").removeClass("text-warning text-danger text-muted").addClass("text-success");
      $(".webdavHost").addClass("is-valid").removeClass("is-invalid");
      if (prefs.congServerUser && prefs.congServerPass) {
        $("#webdavStatus").removeClass("text-success text-danger text-muted").addClass("text-warning");
        var webdavLoginSuccessful = false;
        try {
          webdavClient = createClient(
            "https://" + prefs.congServer + ":" + prefs.congServerPort,
            {
              username: prefs.congServerUser,
              password: prefs.congServerPass
            }
          );
          await webdavClient.getDirectoryContents("/");
          webdavLoginSuccessful = true;
          $("#webdavStatus").removeClass("text-warning text-danger text-muted").addClass("text-success");
          $(".webdavCreds").addClass("is-valid");
        } catch(err) {
          $("#webdavStatus").removeClass("text-success text-warning text-muted").addClass("text-danger");
          $(".webdav" + (err.response && err.response.status === 401 ? "Creds" : "Host")).addClass("is-invalid");
          console.error(err.response);
        }
      } else {
        $(".webdavCreds").addClass("is-invalid");
      }
    } else {
      $("#webdavStatus").removeClass("text-success text-warning text-muted").addClass("text-danger");
    }
    $("#specificCong").addClass("d-flex");
    $("#btn-upload").fadeIn(animationDuration);
    var webdavDirIsValid = false;
    if (prefs.congServerDir == null || prefs.congServerDir.length === 0) $("#congServerDir").val("/").change();
    if (webdavLoginSuccessful) {
      $("#webdavFolderList").fadeTo(animationDuration, 0);
      try {
        let webdavDestDirExists = await webdavClient.exists(prefs.congServerDir);
        if (webdavDestDirExists) webdavDirIsValid = true;
        $("#webdavFolderList").empty();
        let webdavDestDir = await webdavLs((webdavDestDirExists ? prefs.congServerDir : "/"), true);
        for (var item of webdavDestDir) {
          if (item.type == "directory") $("#webdavFolderList").append("<li><i class='fas fa-fw fa-folder-open'></i>" + item.basename + "</li>");
        }
        if (prefs.congServerDir !== "/") $("#webdavFolderList").prepend("<li><i class='fas fa-fw fa-chevron-circle-up'></i> ../ </li>");
        $("#webdavFolderList").css("column-count", Math.ceil($("#webdavFolderList li").length / 8));
      } catch(err) {
        console.error(err);
      }
      $("#webdavFolderList").fadeTo(animationDuration, 1);
      $("#congServerDir").toggleClass("is-valid", webdavDirIsValid).toggleClass("is-invalid", !webdavDirIsValid);
      $("#webdavFolderList li").click(function() {
        $("#congServerDir").val(path.posix.join((webdavDirIsValid ? prefs.congServerDir : "/"), $(this).text().trim())).change();
      });
    } else {
      $("#webdavFolderList").empty();
    }
    if ((webdavLoginSuccessful && webdavDirIsValid) || !prefs.congServer || prefs.congServer.length === 0) {
      $("#btn-settings, #overlaySettings .btn-webdav.btn-danger").removeClass("in-danger");
      $(".btn-webdav, #btn-upload").addClass("btn-primary").removeClass("btn-danger");
      $("#specificCong").removeClass("alert-danger").find("i").removeClass("fa-times-circle").addClass("fa-spinner");
    }
    $("#btn-upload").prop("disabled", !(webdavLoginSuccessful && webdavDirIsValid));
    $("#additionalMediaPrompt").prop("disabled", (webdavLoginSuccessful && webdavDirIsValid));
    webdavIsAGo = (webdavLoginSuccessful && webdavDirIsValid);
    if (webdavLoginSuccessful && webdavDirIsValid) {
      $("#btn-upload").fadeTo(animationDuration, 1);
      $("#additionalMediaPrompt").prop("checked", false).change();
    } else {
      $("#btn-upload, .btn-webdav").addClass("btn-danger").removeClass("btn-primary");
      $("#specificCong").addClass("alert-danger").find("i").addClass("fa-times-circle").removeClass("fa-spinner fa-check-circle");
      $("#btn-settings, #overlaySettings .btn-webdav.btn-danger").addClass("in-danger");
    }
  } else {
    $("#webdavFolderList").fadeTo(animationDuration, 0).empty();
    $(".btn-webdav.btn-warning").addClass("btn-primary").removeClass("btn-danger");
    $("#specificCong").removeClass("d-flex");
    $("#btn-upload").fadeOut(animationDuration);
    webdavIsAGo = false;
    $("#additionalMediaPrompt").prop("disabled", false);
  }
}
var dragenterHandler = () => {
  if ($("input#typeFile:checked").length > 0 || $("input#typeJwpub:checked").length > 0) $(".dropzone").css("display", "block");
};
var dragleaveHandler = (event) => {
  if (event.target.id == "dropzone") $(".dropzone").css("display", "none");
};
var dragoverHandler = (e) => {
  e.preventDefault();
  e.stopPropagation();
};
var dropHandler = (event) => {
  event.preventDefault();
  event.stopPropagation();
  var filesDropped = [];
  for (const f of event.dataTransfer.files) {
    filesDropped.push(f.path);
  }
  if ($("input#typeFile:checked").length > 0) {
    $("#filePicker").val(filesDropped.join(" -//- ")).change();
  } else if ($("input#typeJwpub:checked").length > 0) {
    $("#jwpubPicker").val(filesDropped.filter(filepath => path.extname(filepath) == ".jwpub")[0]).change();
  }
  $(".dropzone").css("display", "none");
};
$(document).on("select2:open", () => {
  document.querySelector(".select2-search__field").focus();
});
$("#baseDate").on("click", ".dropdown-item", function() {
  setVars();
  baseDate = dayjs($(this).val()).startOf("isoWeek");
  cleanUp([paths.media]);
  $("#baseDate .dropdown-item.active").removeClass("active");
  $(this).addClass("active");
  $("#baseDate > button").text($(this).text());
  $(".alertIndicators").find("i").addClass("fa-spinner").removeClass("fa-check-circle");
  dateFormatter();
});
$("#btnCancelUpload").on("click", () => {
  $("#overlayUploadFile").slideUp(animationDuration);
  $("#chooseMeeting input:checked, #chooseUploadType input:checked").prop("checked", false);
  $("#fileList, #filePicker, #jwpubPicker, #enterPrefix input").val("").empty().change();
  $("#chooseMeeting .active, #chooseUploadType .active").removeClass("active");
  dryrun = false;
  removeEventListeners();
});
$("#btnMeetingMusic").on("click", async function() {
  if (prefs.enableMusicButton) $(".relatedToFadeOut, #enableMusicFadeOut, #enableMusicButton").prop("disabled", true);
  if (prefs.enableMusicFadeOut) {
    let timeBeforeFade;
    let rightNow = dayjs();
    if (prefs.musicFadeOutType == "smart") {
      if ((now.day() - 1) == prefs.mwDay || (now.day() - 1) == prefs.weDay) {
        var todaysMeeting = ((now.day() - 1) == prefs.mwDay ? "mw" : "we");
        let todaysMeetingStartTime = prefs[todaysMeeting + "StartTime"].split(":");
        let timeToStartFading = now.clone().hour(todaysMeetingStartTime[0]).minute(todaysMeetingStartTime[1]).millisecond(rightNow.millisecond()).subtract(prefs.musicFadeOutTime, "s");
        timeBeforeFade = timeToStartFading.diff(rightNow);
      }
    } else {
      timeBeforeFade = prefs.musicFadeOutTime * 1000 * 60;
    }
    if (timeBeforeFade >= 0) {
      pendingMusicFadeOut.endTime = timeBeforeFade + rightNow.valueOf();
      pendingMusicFadeOut.id = setTimeout(function () {
        $("#btnStopMeetingMusic").click();
      }, timeBeforeFade);
    } else {
      pendingMusicFadeOut.endTime = 0;
    }
  } else {
    pendingMusicFadeOut.id = null;
  }
  $("#btnStopMeetingMusic i").addClass("fa-circle-notch fa-spin").removeClass("fa-stop").parent().prop("title", "...");
  $("#btnMeetingMusic, #btnStopMeetingMusic").toggle();
  var songs = (await getMediaLinks("sjjm", null, null, "MP3")).sort(() => .5 - Math.random());
  var iterator = 0;
  function createAudioElem(iterator) {
    $("body").append($("<audio id='meetingMusic' autoplay>").data("track", songs[iterator].track).on("ended", function() {
      $("#meetingMusic").remove();
      iterator = (iterator < songs.length - 1 ? iterator + 1 : 0);
      createAudioElem(iterator);
    }).on("loadstart", function() {
      $("#btnStopMeetingMusic i").addClass("fa-circle-notch fa-spin").removeClass("fa-stop").parent().prop("title", "...");
      displayMusicRemaining();
    }).on("canplay", function() {
      $("#btnStopMeetingMusic i").addClass("fa-stop").removeClass("fa-circle-notch fa-spin").parent().prop("title", songs[iterator].title);
      displayMusicRemaining();
    }).on("timeupdate", function() {
      displayMusicRemaining();
    }).append("<source src='"+ songs[iterator].url + "' type='audio/mpeg'>"));
  }
  createAudioElem(iterator);
});
$(".btn-settings, #btn-settings").on("click", function() {
  toggleScreen("overlaySettings");
});
$("#btnStopMeetingMusic").on("click", function() {
  clearTimeout(pendingMusicFadeOut.id);
  $("#btnStopMeetingMusic").toggleClass("btn-warning btn-danger").prop("disabled", true);
  $("#meetingMusic").animate({volume: 0}, animationDuration * 30, () => {
    $("#meetingMusic").remove();
    $("#btnStopMeetingMusic").hide().toggleClass("btn-warning btn-danger").prop("disabled", false);
    $("#musicRemaining").empty();
    if (prefs.enableMusicButton) {
      $("#btnMeetingMusic").show();
      $("#enableMusicFadeOut, #enableMusicButton").prop("disabled", false);
      if (prefs.enableMusicFadeOut) $(".relatedToFadeOut").prop("disabled", false);
    }
  });
});
$(".btn-webdav").on("click", function() {
  webdavSetup();
  toggleScreen("overlayWebdav");
});
$("#btnUpload").on("click", async () => {
  try {
    $("#btnUpload").prop("disabled", true).find("i").addClass("fa-circle-notch fa-spin").removeClass("fa-save");
    $("#btnCancelUpload, #chooseMeeting input, .relatedToUploadType input, .relatedToUpload select, .relatedToUpload input").prop("disabled", true);
    if ($("input#typeSong:checked").length > 0) {
      var songFile = new Buffer(await get($("#fileToUpload").val(), true));
      if (currentStep == "additionalMedia") {
        fs.writeFileSync(path.join(paths.media, $("#chooseMeeting input:checked").prop("id"), sanitizeFilename(prefix + " " + path.basename($("#fileToUpload").val()))), songFile);
      } else {
        await webdavPut(songFile, path.posix.join(prefs.congServerDir, "Media", $("#chooseMeeting input:checked").prop("id")), sanitizeFilename(prefix + " " + path.basename($("#fileToUpload").val())));
      }
    } else if ($("input#typeJwpub:checked").length > 0) {
      for (var tempMedia of tempMediaArray) {
        if (tempMedia.url) tempMedia.contents = new Buffer(await get(tempMedia.url, true));
        if (currentStep == "additionalMedia") {
          if (tempMedia.contents) {
            fs.writeFileSync(path.join(paths.media, $("#chooseMeeting input:checked").prop("id"), sanitizeFilename(prefix + " " + tempMedia.filename)), tempMedia.contents);
          } else {
            fs.copyFileSync(tempMedia.localpath, path.join(paths.media, $("#chooseMeeting input:checked").prop("id"), sanitizeFilename(prefix + " " + tempMedia.filename)));
          }
        } else {
          await webdavPut((tempMedia.contents ? tempMedia.contents : fs.readFileSync(tempMedia.localpath)), path.posix.join(prefs.congServerDir, "Media", $("#chooseMeeting input:checked").prop("id")), sanitizeFilename(prefix + " " + tempMedia.filename));
        }
      }
      tempMediaArray = [];
    } else {
      var localFile = $("#fileToUpload").val();
      for (var splitLocalFile of localFile.split(" -//- ")) {
        var splitFileToUploadName = sanitizeFilename(prefix + " " + path.basename(splitLocalFile));
        if (currentStep == "additionalMedia") {
          fs.copyFileSync(splitLocalFile, path.join(paths.media, $("#chooseMeeting input:checked").prop("id"), splitFileToUploadName));
        } else {
          await webdavPut(fs.readFileSync(splitLocalFile), path.posix.join(prefs.congServerDir, "Media", $("#chooseMeeting input:checked").prop("id")), splitFileToUploadName);
        }
      }
    }
    $("#overlayDryrun").fadeIn(animationDuration, async () => {
      dryrun = true;
      await startMediaSync();
      $("#chooseMeeting input:checked").change();
      $("#btnUpload").prop("disabled", false).find("i").addClass("fa-save").removeClass("fa-circle-notch fa-spin");
      $("#btnCancelUpload, #chooseMeeting input, .relatedToUploadType input, .relatedToUpload select, .relatedToUpload input").prop("disabled", false);
      $("#overlayDryrun").stop().fadeOut(animationDuration);
    });
  } catch (err) {
    console.error(err);
  }
});
$("#btn-upload").on("click", function() {
  $("#overlayDryrun").slideDown(animationDuration, async () => {
    dryrun = true;
    await startMediaSync();
    $(".alertIndicators").find("i").addClass("fa-spinner").removeClass("fa-check-circle");
    $("#chooseMeeting").empty();
    for (var meeting of [prefs.mwDay, prefs.weDay]) {
      let meetingDate = baseDate.add(meeting, "d").format("YYYY-MM-DD");
      $("#chooseMeeting").append("<input type='radio' class='btn-check' name='chooseMeeting' id='" + meetingDate + "' autocomplete='off'><label class='btn btn-outline-primary' for='" + meetingDate + "'" + (Object.prototype.hasOwnProperty.call(meetingMedia, meetingDate) ? "" : " style='display: none;'") + ">" + meetingDate + "</label>");
    }
    currentStep = "uploadFile";
    $(".relatedToUpload, .relatedToUploadType, #btnDoneUpload").fadeTo(animationDuration, 0);
    $("#btnCancelUpload").fadeTo(animationDuration, 1);
    $("#overlayUploadFile").fadeIn(animationDuration, () => {
      $("#overlayDryrun").stop().hide();
    });
  });
});
$("#chooseUploadType input").on("change", function() {
  $("#songPicker:visible").select2("destroy");
  $("#songPicker, #jwpubPicker, #filePicker").hide();
  $("#fileToUpload").val("").change();
  if ($("input#typeSong:checked").length > 0) {
    $("#songPicker").val([]).prop("disabled", false).show().select2();
  } else if ($("input#typeFile:checked").length > 0) {
    $("#filePicker").val("").prop("disabled", false).show();
  } else if ($("input#typeJwpub:checked").length > 0) {
    $("#jwpubPicker").val([]).prop("disabled", false).show();
  }
});
$("#enterPrefix input, #congServerPort").on("keypress", function(e){ // cmd/ctrl || arrow keys || delete key || numbers
  return e.metaKey || e.which <= 0 || e.which === 8 || /[0-9]/.test(String.fromCharCode(e.which));
});
$("#overlayUploadFile").on("change", "#filePicker", function() {
  $("#fileToUpload").val($(this).val()).change();
});
$("#overlayUploadFile").on("change", "#jwpubPicker", async function() {
  if ($(this).val().length >0) {
    let contents = await getDbFromJwpub(null, null, $(this).val());
    let tableMultimedia = ((await executeStatement(contents, "SELECT * FROM sqlite_master WHERE type='table' AND name='DocumentMultimedia'")).length === 0 ? "Multimedia" : "DocumentMultimedia");
    let suppressZoomExists = (await executeStatement(contents, "SELECT COUNT(*) AS CNTREC FROM pragma_table_info('Multimedia') WHERE name='SuppressZoom'")).map(function(item) {
      return (item.CNTREC > 0 ? true : false);
    })[0];
    let itemsWithMultimedia = await executeStatement(contents, "SELECT DISTINCT	" + tableMultimedia + ".DocumentId, Document.Title FROM Document INNER JOIN " + tableMultimedia + " ON Document.DocumentId = " + tableMultimedia + ".DocumentId " + (tableMultimedia === "DocumentMultimedia" ? "INNER JOIN Multimedia ON Multimedia.MultimediaId = DocumentMultimedia.MultimediaId " : "") + "WHERE (Multimedia.CategoryType = 8 OR Multimedia.CategoryType = -1)" + (suppressZoomExists ? " AND Multimedia.SuppressZoom = 0" : "") + " ORDER BY " + tableMultimedia + ".DocumentId");
    if (itemsWithMultimedia.length > 0) {
      var docList = $("<div id='docSelect' class='list-group'>");
      for (var item of itemsWithMultimedia) {
        $(docList).append("<button class='list-group-item list-group-item-action' data-docid='" + item.DocumentId + "'>" + item.Title + "</li>");
      }
      $("#staticBackdrop .modal-header").text(i18n.__("selectDocument"));
      $("#staticBackdrop .modal-body").html(docList);
    } else {
      $("#staticBackdrop .modal-body").text(i18n.__("noDocumentsFound"));
      $(this).val("");
      $("#fileToUpload").val("").change();
    }
    $("#staticBackdrop .modal-header").toggle(itemsWithMultimedia.length > 0);
    $("#staticBackdrop .modal-footer").toggle(itemsWithMultimedia.length === 0);
    myModal.show();
  } else {
    $("#fileToUpload").val("").change();
  }
});
$("#staticBackdrop").on("mousedown", "#docSelect button", async function() {
  $("#docSelect button").prop("disabled", true);
  $(this).addClass("active");
  tempMediaArray = [];
  var multimediaItems = await getDocumentMultimedia((await getDbFromJwpub(null, null, $("#jwpubPicker").val())), $(this).data("docid"), null, true);
  var missingMedia = $("<div id='missingMedia' class='list-group'>");
  for (var i = 0; i < multimediaItems.length; i++) {
    let multimediaItem = multimediaItems[i];
    var tempMedia = {
      filename: (i + 1).toString().padStart(2, "0") + " - " + (multimediaItem.queryInfo.FilePath ? multimediaItem.queryInfo.FilePath : multimediaItem.queryInfo.KeySymbol + "." + (multimediaItem.queryInfo.MimeType.includes("video") ? "mp4" : "mp3"))
    };
    if (multimediaItem.queryInfo.CategoryType !== -1) {
      var jwpubContents = await new zipper($("#jwpubPicker").val()).readFile("contents");
      var mediaEntry = (await new zipper(jwpubContents).getEntries()).filter(entry => entry.name == multimediaItem.queryInfo.FilePath)[0];
      tempMedia.contents = (await new zipper(jwpubContents).readFile(mediaEntry.entryName));
    } else {
      var externalMedia = (await getMediaLinks(multimediaItem.queryInfo.KeySymbol, multimediaItem.queryInfo.Track, multimediaItem.queryInfo.IssueTagNumber, null, multimediaItem.queryInfo.MultiMeps));
      if (externalMedia.length > 0) {
        Object.assign(tempMedia, externalMedia[0]);
        tempMedia.filename = (i + 1).toString().padStart(2, "0") + " - " + path.basename(tempMedia.url);
      } else {
        $(missingMedia).append($("<button class='list-group-item list-group-item-action' data-filename='" + tempMedia.filename + "'>" + tempMedia.filename + "</li>").on("click", function() {
          var missingMediaPath = remote.dialog.showOpenDialogSync({
            title: $(this).data("filename"),
            filters: [
              { name: $(this).data("filename"), extensions: [path.extname($(this).data("filename")).replace(".", "")] }
            ]
          });
          if (typeof missingMediaPath !== "undefined") {
            tempMediaArray.find(item => item.filename == $(this).data("filename")).localpath = missingMediaPath[0];
            $(this).addClass("list-group-item-primary");
          }
          if (tempMediaArray.filter(item => !item.contents && !item.localpath).length === 0) {
            $("#staticBackdrop .modal-footer button").prop("disabled", false);
            $("#fileToUpload").val(tempMediaArray.map(item => item.filename).join(" -//- ")).change();
          }
        }));
      }
    }
    tempMediaArray.push(tempMedia);
  }
  if (tempMediaArray.filter(item => !item.contents && !item.localpath && !item.url).length > 0) {
    $("#staticBackdrop .modal-header").show().text(i18n.__("selectExternalMedia"));
    $("#staticBackdrop .modal-body").html(missingMedia);
    $("#staticBackdrop .modal-footer button").prop("disabled", true);
    $("#staticBackdrop .modal-footer").show();
  } else {
    $("#fileToUpload").val(tempMediaArray.map(item => item.filename).join(" -//- ")).change();
    myModal.hide();
  }
});

$("#mediaSync").on("click", async function() {
  $("#mediaSync, #baseDate-dropdown").prop("disabled", true);
  dryrun = false;
  await startMediaSync();
  if (prefs.autoQuitWhenDone) $("#btnStayAlive").fadeTo(animationDuration, 1);
  $("#btnStayAlive").on("click", function() {
    stayAlive = true;
    $("#btnStayAlive").removeClass("btn-primary").addClass("btn-success");
  });
  $("#overlayComplete").fadeIn().delay(3000).fadeOut(animationDuration, () => {
    if (prefs.autoQuitWhenDone) {
      if (stayAlive) {
        toggleScreen("overlaySettings");
        $("#btnStayAlive").removeClass("btn-success").addClass("btn-primary").fadeTo(animationDuration, 0);
      } else {
        remote.app.quit();
      }
    }
    $("#home, .btn-settings, #btn-settings" + (prefs.congServer && prefs.congServer.length > 0 ? " #btn-upload" : "")).fadeTo(animationDuration, 1);
  });
  $("#mediaSync, #baseDate-dropdown").prop("disabled", false);
});
$("#outputPath").on("mousedown", function(event) {
  var path = remote.dialog.showOpenDialogSync({
    properties: ["openDirectory"]
  });
  $(this).val(path).change();
  event.preventDefault();
});
$("#overlaySettings").on("click", ".btn-clean-up", function() {
  $(this).addClass("btn-success").removeClass("btn-warning").prop("disabled", true);
  setVars();
  cleanUp([paths.lang, paths.langs, paths.pubs]);
  setTimeout(() => {
    $(".btn-clean-up").removeClass("btn-success").addClass("btn-warning").prop("disabled", false);
  }, 3000);
});
$("#overlayUploadFile").on("change", "#chooseMeeting input", function() {
  removeEventListeners();
  document.addEventListener("drop", dropHandler);
  document.addEventListener("dragover", dragoverHandler);
  document.addEventListener("dragenter", dragenterHandler);
  document.addEventListener("dragleave", dragleaveHandler);
  $("#chooseUploadType input").prop("checked", false).change();
  $("#chooseUploadType label.active").removeClass("active");
  $(".relatedToUploadType").fadeTo(animationDuration, 1);
});
$("#overlayUploadFile").on("change", "#chooseMeeting input, #chooseUploadType input", function() {
  $("#enterPrefix input").val("").empty().change();
  getPrefix();
  $(".relatedToUpload").fadeTo(animationDuration, ($("#chooseMeeting input:checked").length === 0 || $("#chooseUploadType input:checked").length === 0 ? 0 : 1));
});
$("#overlayUploadFile").on("change", "#enterPrefix input, #chooseMeeting input, #fileToUpload", function() {
  try {
    if ($("#chooseMeeting input:checked").length > 0) {
      $(".relatedToUpload *:not(.enterPrefixInput):enabled").prop("disabled", true).addClass("fileListLoading");
      $("#fileList").stop().fadeTo(animationDuration, 0, () => {
        var weekMedia = [];
        if (currentStep == "additionalMedia") {
          fs.readdirSync(path.join(paths.media, $("#chooseMeeting input:checked").prop("id"))).map(function(item) {
            weekMedia.push({
              title: item,
              media: [{
                safeName: item,
                url: item
              }]
            });
          });
        } else {
          if (!meetingMedia[$("#chooseMeeting input:checked").prop("id")]) meetingMedia[$("#chooseMeeting input:checked").prop("id")] = [];
          weekMedia = meetingMedia[$("#chooseMeeting input:checked").prop("id")].filter(mediaItem => mediaItem.media.length > 0);
          if ("Recurring" in meetingMedia) weekMedia = weekMedia.concat(meetingMedia.Recurring);
        }
        var newFiles = [];
        let newFileChosen = $("#fileToUpload").val() !== null && $("#fileToUpload").val() !== undefined && $("#fileToUpload").val().length > 0;
        if (newFileChosen) {
          for (var splitFileToUpload of $("#fileToUpload").val().split(" -//- ")) {
            newFiles.push({
              title: "New file!",
              media: [{
                safeName: sanitizeFilename(prefix + " " + path.basename(splitFileToUpload)).trim(),
                newFile: true,
                recurring: false,
              }]
            });
          }
          weekMedia = weekMedia.concat(newFiles);
        }
        var newList = [];
        for (var weekMediaItem of weekMedia) {
          newList = newList.concat(weekMediaItem.media);
        }
        newList = newList.sort((a, b) => a.safeName.localeCompare(b.safeName));
        $("#fileList").empty();
        for (var file of newList) {
          let html = $("<li title='" + file.safeName + "' data-url='" + file.url + "' data-safename='" + file.safeName + "'>" + file.safeName + "</li>");
          if (file.congSpecific && file.recurring) html.prepend("<i class='fas fa-fw fa-sync-alt'></i>").addClass("recurring");
          if ((currentStep == "additionalMedia" && !file.newFile) || (file.congSpecific && !file.recurring)) html.prepend("<i class='fas fa-fw fa-minus-circle'></i>").addClass("canDelete");
          if (currentStep !== "additionalMedia" && (!file.congSpecific || file.recurring) && !file.hidden && !file.newFile) html.prepend("<i class='far fa-fw fa-check-square'></i>").wrapInner("<span class='canHide'></span>");
          if (file.newFile) html.addClass("new-file").prepend("<i class='fas fa-fw fa-plus'></i>");
          if (!file.newFile && newFiles.filter(item => item.media.filter(mediaItem => mediaItem.safeName.includes(file.safeName)).length > 0).length > 0) html.addClass("duplicated-file");
          if (file.hidden) html.prepend("<i class='far fa-fw fa-square'></i>").wrapInner("<del class='wasHidden'></del>");
          if (file.safeName.includes(".mp4")) html.addClass("video");
          $("#fileList").append(html);
        }
        $("#fileList").css("column-count", Math.ceil($("#fileList li").length / 8));
        $("#fileList li").on("click", ".fa-minus-circle", function() {
          $(this).parent().addClass("confirmDelete").find(".fa-minus-circle").removeClass("fa-minus-circle").addClass("fa-exclamation-circle");
          setTimeout(() => {
            $(".confirmDelete").removeClass("confirmDelete").find(".fa-exclamation-circle").removeClass("fa-exclamation-circle").addClass("fa-minus-circle");
          }, 3000);
        });
        $("#fileList li").on("click", ".fa-exclamation-circle", function() {
          if (currentStep == "additionalMedia") {
            fs.rmSync(path.join(paths.media, $("#chooseMeeting input:checked").prop("id"), $(this).parent().data("url")));
          } else {
            webdavRm($(this).parent().data("url"));
            cleanUp([paths.media]);
          }
          $(this).parent().fadeOut(animationDuration, function(){
            $(this).remove();
          });
          meetingMedia[$("#chooseMeeting input:checked").prop("id")].splice(meetingMedia[$("#chooseMeeting input:checked").prop("id")].findIndex(item => item.media.find(mediaItem => mediaItem.url === $(this).parent().data("url"))), 1);
        });
        $("#fileList").on("click", ".canHide", function() {
          webdavPut(Buffer.from("hide", "utf-8"), path.posix.join(prefs.congServerDir, "Hidden", $("#chooseMeeting input:checked").prop("id")), $(this).parent().data("safename"));
          $(this).parent()
            .find("span.canHide").contents().unwrap().parent()
            .prepend("<i class='far fa-fw fa-square'></i>")
            .wrapInner("<del class='wasHidden'></del>")
            .find("i.fa-check-square").remove();
        });
        $("#fileList").on("mouseup", ".wasHidden", function() {
          webdavRm(path.posix.join(prefs.congServerDir, "Hidden", $("#chooseMeeting input:checked").prop("id"), $(this).parent().data("safename")));
          $(this).parent()
            .find("del.wasHidden").contents().unwrap().parent()
            .prepend("<i class='far fa-fw fa-check-square'></i>")
            .wrapInner("<span class='canHide'></del>")
            .find("i.fa-square").remove();
        });
        $("#btnUpload").fadeTo(animationDuration, newFileChosen);
        $("#" + (currentStep == "additionalMedia" ? "btnDoneUpload" : "btnCancelUpload")).fadeTo(animationDuration, !newFileChosen);
        $("#fileList").stop().fadeTo(animationDuration, 1, () => {
          $(".fileListLoading").prop("disabled", false).removeClass("fileListLoading");
        });
      });
    }
  } catch (err) {
    console.error(err);
  }
});
$("#overlayUploadFile").on("keyup", "#enterPrefix input", function() {
  getPrefix();
});
$("#overlayUploadFile").on("mousedown", "input#filePicker", function(event) {
  let path = remote.dialog.showOpenDialogSync({
    properties: ["multiSelections", "openFile"]
  });
  $(this).val((typeof path !== "undefined" ? path.join(" -//- ") : "")).change();
  event.preventDefault();
});
$("#overlayUploadFile").on("mousedown", "input#jwpubPicker", function(event) {
  let path = remote.dialog.showOpenDialogSync({
    filters: [
      { name: "JWPUB", extensions: ["jwpub"] }
    ]
  });
  $(this).val((typeof path !== "undefined" ? path : "")).change();
  event.preventDefault();
});

// async function getMwMediaFromWol(jsonRefContent) {
//   if (!dryrun) $("#day" + prefs.mwDay).addClass("alert-warning").removeClass("alert-primary").find("i").removeClass("fa-check-circle").addClass("fa-spinner fa-pulse");
//   try{
//     var mwDate = dayjs(baseDate).add(prefs.mwDay, "days").format("YYYY-MM-DD");
//     totals[mwDate] = {}, meetingMedia[mwDate] = [];
//     let parsedHtml = $(jsonRefContent, newHTMLDocument);
//     var mwItems = parsedHtml.find(".so");
//     totals[mwDate].total = mwItems.length, totals[mwDate].current = 1;
//     for (var i = 0; i < mwItems.length; i++) {
//       progressSet(totals[mwDate].current, totals[mwDate].total, "day" + prefs.mwDay);
//       var mwItem = parsedHtml.find(".so").eq(i);
//       var meetingMediaElement = {};
//       meetingMediaElement.title = mwItem.text();
//       meetingMediaElement.media = [];
//       for (let link of mwItem.find("a")) {
//         var splitUrl = $(link).attr("href").split("/");
//         if (splitUrl.includes("datalink")) {
//           console.log("NOT INCLUDING:", {url: $(link).attr("href")});
//         } else if (splitUrl.includes("https:")) {
//           let url = new URL($(link).data().video);
//           let mediaItem = await getMediaLinks(url.searchParams.get("pub"), url.searchParams.get("track"), url.searchParams.get("issue"), url.searchParams.get("fileformat"));
//           mediaItem[0].folder = mwDate;
//           meetingMediaElement.media.push(mediaItem[0]);
//         } else {
//           var jsonUrl = splitUrl.join("/");
//           let result = await get(wolBase + jsonUrl);
//           var jsonRefItem = result.items[0];
//           if (jsonRefItem.categories.includes("sgbk")) {
//             var track = $(link).text().replace(/\D/g, "");
//             let mediaItem = await getMediaLinks(jsonRefItem.englishSymbol + "m", track);
//             mediaItem[0].folder = mwDate;
//             meetingMediaElement.media.push(mediaItem[0]);
//           } else {
//             let jsonRefItemContent = $(jsonRefItem.content, newHTMLDocument);
//             for (var img of jsonRefItemContent.find("img:not(.suppressZoom):not(.west_left)")) { // not sure about west_left.. trying to avoid the mwb sample conversation pictures
//               var meetingMediaInfo = {
//                 title: $(img).attr("alt"),
//                 url: ($(img).attr("src").includes("https") ? "" : wolBase) + $(img).attr("src")
//               };
//               var imgHeaders = await head(meetingMediaInfo.url);
//               meetingMediaInfo.filesize = parseInt(imgHeaders["content-length"]);
//               meetingMediaInfo.filetype = imgHeaders["content-type"].split("/").slice(-1).pop();
//               meetingMediaInfo.folder = mwDate;
//               meetingMediaElement.media.push(meetingMediaInfo);
//             }
//           }
//         }
//       }
//       meetingMedia[mwDate].push(meetingMediaElement);
//       totals[mwDate].current++;
//       progressSet(totals[mwDate].current, totals[mwDate].total, "day" + prefs.mwDay);
//     }
//     if (!dryrun) {
//       $("#day" + prefs.mwDay).addClass("alert-success").find("i").addClass("fa-check-circle");
//     }
//   } catch(err) {
//     console.error(err);
//     $("#day" + prefs.mwDay).addClass("alert-danger").find("i").addClass("fa-times-circle");
//   }
//   if (!dryrun) $("#day" + prefs.mwDay).removeClass("alert-warning").find("i").removeClass("fa-spinner fa-pulse");
// }
// async function getWeMediaFromWol(jsonRefContent) {
//   if (!dryrun) $("#day" + prefs.weDay).addClass("alert-warning").removeClass("alert-primary").find("i").removeClass("fa-check-circle").addClass("fa-spinner fa-pulse");
//   try {
//     let htmlDoc = $(jsonRefContent, newHTMLDocument);
//     let wtRefContent = await get(wolBase + htmlDoc.find("a").attr("href"));
//     var wtContent = wtRefContent.items[0].content;
//     htmlDoc = $(wtContent, newHTMLDocument);
//     var studyDate = dayjs(baseDate).add(prefs.weDay, "days").format("YYYY-MM-DD");
//     totals[studyDate] = {};
//     meetingMedia[studyDate] = [{
//       title: wtRefContent.items[0].title,
//       media: []
//     }];
//     totals[studyDate].total = htmlDoc.find("img:not(.suppressZoom)").length + htmlDoc.find(".pubRefs a:not(.fn)").length, totals[studyDate].current = 1;
//     for (var img of htmlDoc.find("img:not(.suppressZoom)")) {
//       progressSet(totals[studyDate].current, totals[studyDate].total, "day" + prefs.weDay);
//       var mediaInfo = {
//         title: $(img).attr("alt"),
//         folder: studyDate,
//         url: ($(img).attr("src").includes("https") ? "" : wolBase) + $(img).attr("src")
//       };
//       var imgHeaders = await head(mediaInfo.url);
//       mediaInfo.filesize = parseInt(imgHeaders["content-length"]);
//       mediaInfo.filetype = imgHeaders["content-type"];
//       if (mediaInfo.title == "") {
//         var figcaption = $(img).parent().find(".figcaption").text().trim();
//         if (figcaption.length > 0) mediaInfo.title = figcaption;
//       }
//       meetingMedia[studyDate][0].media.push(mediaInfo);
//       totals[studyDate].current++;
//       progressSet(totals[studyDate].current, totals[studyDate].total, "day" + prefs.weDay);
//     }
//     var firstSong = true;
//     for (var songLink of htmlDoc.find("a:not(.b) > strong")) {
//       songLink = $(songLink).parent();
//       progressSet(totals[studyDate].current, totals[studyDate].total, "day" + prefs.weDay);
//       let songRefContent = await get(wolBase + $(songLink).attr("href"));
//       var songItem = songRefContent.items[0];
//       var track = $(songLink).text().replace(/\D/g, "");
//       let mediaItem = await getMediaLinks(songItem.englishSymbol + "m", track);
//       mediaItem[0].folder = studyDate;
//       if (firstSong) {
//         meetingMedia[studyDate][0].media.splice(0, 0, mediaItem[0]);
//       } else {
//         meetingMedia[studyDate][0].media.push(mediaItem[0]);
//       }
//       firstSong = false;
//       totals[studyDate].current++;
//       progressSet(totals[studyDate].current, totals[studyDate].total, "day" + prefs.weDay);
//     }
//     if (!dryrun) $("#day" + prefs.weDay).addClass("alert-success").find("i").addClass("fa-check-circle");
//   } catch(err) {
//     console.error(err);
//     $("#day" + prefs.weDay).addClass("alert-danger").find("i").addClass("fa-times-circle");
//   }
//   if (!dryrun) $("#day" + prefs.weDay).removeClass("alert-warning").find("i").removeClass("fa-spinner fa-pulse");
// }
