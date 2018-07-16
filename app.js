
const firebase = require('firebase');
var config = {
	apiKey: "AIzaSyCtsK9Nx0Fh7YzwZ8r7V2oXw_cB0XQG4z8",
	authDomain: "webedit-204210.firebaseapp.com",
	databaseURL: "https://webedit-204210.firebaseio.com",
	projectId: "webedit-204210",
	storageBucket: "webedit-204210.appspot.com",
	messagingSenderId: "1059738201826"
};
firebase.initializeApp(config);
const root = firebase.database().ref();
const projects = root.child('projects');

const fileupload = require('express-fileupload');
const express = require('express');
const favicon = require('express-favicon');
const randomstring = require('randomstring');
const cookieParser = require('cookie-parser');
const archiver = require('archiver');
const Storage = require('@google-cloud/storage');

const storage = new Storage({
	projectid: 'webedit-204210'
});
const bucket = storage.bucket('we.nerq.com');
const app = express();
let g = {"cookieToUid": {}};
const PORT = process.env.PORT || 8080;

root.child('admin/admins').on('value', function (snapshot) {
	g.admins = snapshot.val();
	console.log(g.admins);
});

root.child('cookieToUid').on('child_added', updatecookietouid);
root.child('cookieToUid').on('child_changed', updatecookietouid);

function updatecookietouid(snapshot) {
	console.log('A', snapshot.key, snapshot.val());
	g.cookieToUid[snapshot.key] = snapshot.val();	
}

app.use(fileupload());
app.use(cookieParser());

app.use(favicon(__dirname + '/html/images/favicon.jpg'));

app.post('/upload', function (req, res) {
	console.log(req);
	uploadfile(req);
});

app.use(function (req, res, next) {
	console.log('cookies1', req.url, g.cookieToUid)
	if (!req.cookies || !req.cookies.cookieId) {
		let cookieId = randomstring.generate();
		console.log('cookie, uid', g.uid, cookieId);
		res.cookie('cookieId', cookieId);	
	}
	next();
});

app.use(express.static('html'));

app.use(function (req, res) {
	console.log('cookies2', req.url, g.cookieToUid)
	g.uid = g.cookieToUid[req.cookies.cookieId];
	console.log('0', req.cookies.cookieId, g.uid);
	serve(req, res);
});

// Start the server
app.listen(PORT, () => {
	console.log(`App listening on port ${PORT}`);
	console.log('Press Ctrl+C to quit.');
});



function uploadfile(req) {
	//console.log(req.files.file, req.body);
	let uploadedfile = req.files.file.data
	let uid = req.body.uid;
	let projectname = req.body.projectname;
	let filename = req.files.file.name;
	let fileroute = '/' + uid + '/' + projectname + '/' + filename;
	console.log(fileroute)
	let file = bucket.file(fileroute);
	let gcstream = file.createWriteStream();
	gcstream.write(uploadedfile)
	gcstream.on('error', (err) => {
		console.log(err)
	});
	gcstream.on('finish', () => {
		console.log(filename)
	});
	gcstream.end();
}


function readable(ref, uid, project, file) {
	console.log('2', g.uid, uid, project);
	if (!project && (uid == g.uid || g.admins[g.uid])) return Promise.resolve(true);
	return nametoid(ref, uid, project)
	.then(function (projectId) {
		console.log('projectId', projectId)
		if (!projectId && !g.admins[g.uid]) return false;
		if (g.admins[g.uid]) return true;
		return ref.child(uid).child(projectId).once('value')
		.then(function (snapshot) {
			console.log("60", snapshot.val().settings.ispublic, uid == g.uid);
			return snapshot.val().settings.ispublic || uid == g.uid || g.admins[g.uid];
		});
	});
}

function download(res, uid, projectid, projectname) {
	console.log(uid, projectid);
	var archive = archiver('zip');
	var zippedFilename;
	if (projectname) {
		zippedFilename = projectname + '.zip';
	} else zippedFilename = uid + '.zip';
	var header = {
		"Content-Type": "application/x-zip",
		"Pragma": "public",
		"Expires": "0",
		"Cache-Control": "private, must-revalidate, post-check=0, pre-check=0",
		"Content-disposition": 'attachment; filename="' + zippedFilename + '"',
		"Transfer-Encoding": "chunked",
		"Content-Transfer-Encoding": "binary"
	};
	res.writeHead(200, header);
	archive.store = true;  // don't compress the archive
	archive.pipe(res);
	if (projectid) {
		projects.child(uid).child(projectid).once('value')
		.then(function (snapshot) {
			let files = [];
			archive.append('', {name: snapshot.val().name + '/'})
			archive.append(snapshot.val().contents, {name: '/' + snapshot.val().name + '/' + 'index.html'});	
			for (let file in snapshot.val().files) {
				files.push({'name': snapshot.val().files[file].name, 'lastchange': snapshot.val().files[file].lastchange});
				console.log(snapshot.val().files[file].name);
				archive.append(snapshot.val().files[file].contents, {name: '/' + snapshot.val().name + '/' + snapshot.val().files[file].name});	
			}
			archive.append(JSON.stringify(files), {name: '.files.json'});
			archive.finalize();
		});
	} else {
		projects.child(uid).once('value')
		.then(function (snapshot) {
			let projects = [];
			snapshot.forEach(function (snap) {
				projects.push({'name': snap.val().name, 'lastchange': snap.val().lastchange, 'archived': snap.val().archived})
				let files = [];
				if (snap.val().contents && snap.val().settings.archived != true) {
					archive.append('', {name: snap.val().name + '/'})
					archive.append(snap.val().contents, {name: '/' + snap.val().name + '/' + 'index.html'});	
					for (let file in snap.val().files) {
						files.push({'name': snap.val().files[file].name, 'lastchange': snap.val().files[file].lastchange});
						console.log(snap.val().files[file].name);
						archive.append(JSON.stringify(files), {name: '/' + snap.val().name + '/.files'});
						archive.append(snap.val().files[file].contents, {name: '/' + snap.val().name + '/' + snap.val().files[file].name});	
					}
				}
			});
			archive.append(JSON.stringify(projects), {name: '.files.json'});			
			archive.finalize();			
		});
	}
}

function nametosnapshot(ref, uid, name) {
	//console.log(uid, name);
	return ref.child(uid).orderByChild('name').equalTo(name).once('value')
	.then(function (snapshot) {
		let result;
		snapshot.forEach(function (snap) {
			if (snap.val().settings) {
				if (snap.val().settings.archived) return;
			}
			console.log('key', snap.key)
			result = snap;
		});
		if (!result) {
			throw 'ref not found';
		}
		console.log('results', result.key, result.val());
		return result;
	});
}		

function nametoid(ref, uid, name) {
	return nametosnapshot(ref, uid, name)
	.then(function (snapshot) {
		return snapshot.key;
	});
}

function nametoobject(ref, uid, name) {
	return nametosnapshot(ref, uid, name)
	.then(function (snapshot) {
		return snapshot.val();
	});
}

function nametoref(ref, uid, name) {
	return nametosnapshot(ref, uid, name)
	.then(function (snapshot) {
		return snapshot.ref;
	});
}

function createfilelist(ref, uid, projectname) {
	//console.log(projectname, filename);
	if (projectname) {
		return nametoref(ref, uid, projectname)
		.then(function (projectref) {
			return projectref.child('files').once('value');
		})
		.then(function (snapshot) {
			let files = snapshot.val();
			let results = [];
			Object.values(files).forEach(function (file) {
				//console.log(snapshot.val());
				delete file.contents;
				console.log('file', file)
				results.push(file);							
			});
			return JSON.stringify(results);
		});
	} else {
		console.log('.files');
		return ref.child(uid).orderByChild('lastchange').once('value')
		.then(function (snapshot) {
			let allprojects = [];
			snapshot.forEach(function (snap) {
				if (snap.val().name) {
					allprojects.unshift({'name': snap.val().name, 'lastchange': snap.val().lastchange, 'archived': snap.val().settings.archived});
				}
			});
			return JSON.stringify(allprojects);
		});
	}
}

function serve(req, res) {
	let query = req.query;
	let [host, uid, projectname, filename] = req.path.split('/')
	console.log(uid, projectname);
	if (!filename) {
		console.log('URL info:', host, uid, projectname, filename, query.run);
	}
	if (projectname.match(/^\./) && projectname != '.settings') {
		[filename, projectname] = [projectname]
	}
	readable(projects, uid, projectname, filename)
	.then(function (readable) {
		//console.log('readable', readable, filename);
		if (!readable) {
			res.status(401);
			res.send('Access denied');
			return;
		} else {
			if (query.run == 'crashed') {
				projects.child('0GZ6h7paIPSfwN6kvMqxv85p9XX2').child('-LEboYpzmQHHIb9ABL73').child('files' ).child('-LEbovEq_RODq0hVUfpP').once('value', function (snapshot) {
					//console.log('toc');
					res.send(snapshot.val().contents);
				});				
			} else if (filename == '.files.json' || filename == '.files') {
				console.log('252', projectname, filename);
				createfilelist(projects, uid, projectname)
				.then(function (files) {
					res.send(files);
				});
			} else if (!projectname) {
				if (query.run == 'download') {
					download(res, uid)					
				} else {
					console.log('TABLE OF CONTENTS');
					projects.child('0GZ6h7paIPSfwN6kvMqxv85p9XX2').child('-LEboYpzmQHHIb9ABL73').child('files' ).child('-LFVYbMm1BjtqOW6vJpY').once('value', function (snapshot) {
						//console.log('toc');
						res.send(snapshot.val().contents);
					});
				}
			} else if (!filename) {
				if (query.run == 'download') {
					console.log('DOWNLOAD PROJECT');
					nametoid(projects, uid, projectname)
					.then(function (nametoid) {
						download(res, uid, nametoid, projectname)
					});
				} else if (query.run == 'viewer') {
					projects.child('global').child('-LFApck9n3U1YdCYWKEA').child('files' ).child('viewer.html').once('value', function (snapshot) {
						res.send(snapshot.val().contents);
					});				
				} else if (query.run == 'edit' || query.run == 'editor') {
					res.sendFile('editor.html', {root: __dirname + "/html/"});				
				} else {
					console.log('RUN');
					//?run=
					nametoref(projects, uid, projectname)
					.then(projectref => projectref.once('value'))
					.then(function (snapshot) {
						if (true || !snapshot.val().settings.archived) {
							res.send(snapshot.val().contents);
						}
					});
				} 
			} else if (filename) {
				console.log('DEPENDANCY');
				let ref;
				nametoref(projects, uid, projectname)
				.then(function (projectref) {
					ref = projectref;
					nametoref(projectref, 'files', filename)
					.then(function (fileref) {
						fileref.once('value', function (snapshot) {
							console.log('found')
							sendwithtype(res, snapshot.val().name, snapshot.val().contents);
						});
					})
					.catch(function (err) {
						let file = bucket.file('/' + uid + '/' + projectname + '/' + filename);
						console.log('test');
						let filereadstream = file.createReadStream();
						console.log('test2');
						filereadstream.pipe(res);
						filereadstream.on('error', function (err2) {
							if (query.create == 'yes') {
								nametoref(projects, '0GZ6h7paIPSfwN6kvMqxv85p9XX2', 'admin')
								.then(projectref => nametoobject(projectref, 'files', 'template.html'))
								.then(function (fileobj) {
									ref.child('files').push({
										contents: fileobj.contents,
										name: filename,
										lastchange: firebase.database.ServerValue.TIMESTAMP,
									});
									sendwithtype(res, filename, fileobj.contents);
								});								
							} else if (query.create == 'maybe') {
								nametoref(projects, '0GZ6h7paIPSfwN6kvMqxv85p9XX2', 'admin')
								.then(projectref => nametoobject(projectref, 'files', 'notfound.html'))
								.then(fileobj => sendwithtype(res, fileobj.name, fileobj.contents));
							} else {
								res.status(404)
								res.send('file not found')													
							}
						});
					});
				});
			} else {
				res.status(404)
				res.send('Not found')			
			}
		}
	});
}

function sendwithtype(res, name, contents) {
	let type = name.replace(/^.*\.(.*)$/, "$1");
	console.log('type', type, contents);
	if (type == 'js') {type = 'javascript'};
	if (type == 'htm') {type = 'html'};	
	res.set('content-type', 'text/'+type);
	res.send(contents);							
}
















