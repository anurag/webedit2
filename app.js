
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
console.log('port', PORT);

root.child('admin/admins').on('value', function (snapshot) {
	g.admins = snapshot.val();
	console.log(g.admins);
});

root.child('cookieToUid').on('child_added', updatecookietouid);
root.child('cookieToUid').on('child_changed', updatecookietouid);

function updatecookietouid(snapshot) {
	//console.log('A', snapshot.key, snapshot.val());
	g.cookieToUid[snapshot.key] = snapshot.val();	
}

app.use((req, res, next) => {
	//console.log('vhost', req.get('Host'));
	if (PORT != 8081 && req.get('Host') == 'stage.nerq.com') {
		console.log('vhosttru', req.get('Host'));
		res.redirect('//' + req.get('Host') + ':8081');
		return;
	}
	if (PORT != 8080 && req.get('Host') == 'dev.nerq.com') {
		console.log('vhosttru', req.get('Host'));
		res.redirect('//' + req.get('Host') + ':8080');
		return;
	}
	next();
});

app.use(fileupload());
app.use(cookieParser());

app.use(favicon(__dirname + '/html/images/favicon.jpg'));

app.post('/upload', function (req, res) {
	//console.log(req);
	uploadfile(req);
});

app.use(function (req, res, next) {
	//console.log('cookies1', req.url, g.cookieToUid)
	if (!req.cookies || !req.cookies.cookieId) {
		let cookieId = randomstring.generate();
		//console.log('cookie, uid', g.uid, cookieId);
		res.cookie('cookieId', cookieId);	
	}
	next();
});

app.use(express.static('html'));

app.use(function (req, res) {
	//console.log('cookies2', req.url, g.cookieToUid)
	g.uid = g.cookieToUid[req.cookies.cookieId];
	//console.log('0', req.cookies.cookieId, g.uid);
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
	//console.log('2', g.uid, uid, project);
	if (!project && (uid == g.uid || g.admins[g.uid])) return Promise.resolve(true);
	return nametoid(ref, uid, project)
	.then(function (projectId) {
		//console.log('projectId', projectId)
		if (!projectId && !g.admins[g.uid]) return false;
		if (g.admins[g.uid]) return true;
		return ref.child(uid).child(projectId).once('value')
		.then(function (snapshot) {
			//console.log("60", snapshot.val().settings.ispublic, uid == g.uid);
			return snapshot.val().settings.ispublic || uid == g.uid || g.admins[g.uid];
		});
	});
}

function download(res, uid, projectid, projectname) {
	//console.log(uid, projectid);
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
				//console.log(snapshot.val().files[file].name);
				if (!snapshot.val().files[file].archived) {
					archive.append(snapshot.val().files[file].contents, {name: '/' + snapshot.val().name + '/' + snapshot.val().files[file].name});					
				}
			}
//			let globalfiles = [];
			searchfordependancies(uid, snapshot.val().name, snapshot.val().contents)
			.then(function (included) {
				for (let i = 0; i < included.length; i++) {
					console.log('INCLUDED', included[i].name);
					archive.append(included[i].contents, {name: '/' + snapshot.val().name + '/' + included[i].name});					
				};
				return findbucketfiles(uid, projectname)
				.then(function (uploads) {
					//console.log(uploads);
					uploads.forEach(function (upload) {
						if (upload) {
							if (snapshot.val().contents.includes(upload.name)) {
								console.log('file', upload.name);
								archive.append(upload.contents, {name: '/' + snapshot.val().name + '/' + upload.name});							
								delete upload.contents;
								//console.log('file', file)
								files.push(upload);
							}
						}
					});			
					archive.append(JSON.stringify(files), {name: '/' + snapshot.val().name + '/.files.json'});
					archive.finalize();
				});
			});
		});
	} else {
		projects.child(uid).once('value')
		.then(function (snapshot) {
			let projectsfile = [];
			let projects = [];
			snapshot.forEach(function (snap) {
				if (snap.val().name) {
					projects.push(snap.val());
					projectsfile.push({'name': snap.val().name, 'lastchange': snap.val().lastchange, 'archived': snap.val().archived})
				}
			});
			let promises = projects.map(function (file) {
				let files = [];
				return findbucketfiles(uid, file.name)
				.then(function (uploads) {
					uploads.forEach(function (upload) {
						if (upload) {
							if (file.contents.includes(upload.name)) {
								console.log('file', upload.name);
								archive.append(upload.contents, {name: '/' + file.name + '/' + upload.name});							
								delete upload.contents;
								//console.log('file', file)
								files.push(upload);
							}
						}
					});
					return searchfordependancies(uid, file.name, file.contents).then(function (included) {
						if (file.contents && file.settings.archived != true) {
							archive.append('', {name: file.name + '/'})
							archive.append(file.contents, {name: '/' + file.name + '/' + 'index.html'});
							for (let key in file.files) {
								files.push({'name': file.files[key].name, 'lastchange': file.files[key].lastchange, 'archived': file.files[key].archived});
								//console.log(snap.val().files[file].name);
								if (!file.files[key].archived) {
									archive.append(file.files[key].contents, {name: '/' + file.name + '/' + file.files[key].name});	
								}
							}
							if (files.toString()) {
								//console.log(files);
								archive.append(JSON.stringify(files), {name: '/' + file.name + '/.files.json'});					
							}
						};
						return [included, file.name];
					});
				});
			});
			Promise.all(promises).then(function (included) {
				//console.log('FINISHED', included);
				included.forEach(function (projectincludes) {
					if (projectincludes[0]) {
						//console.log('INCLUDED 1', included[i][1], included[i][0]);;
						let includes = projectincludes[0];
						includes.forEach(function (globalfile) {
							//console.log(included[i][1])
							archive.append(globalfile.contents, {name: '/' + projectincludes[1] + '/' + globalfile.name});					
						});
					}
				});
			})
			.then(function() {
				archive.append(JSON.stringify(projectsfile), {name: '.files.json'});			
				archive.finalize();	
			});
		});
	}
}

function findbucketfiles(uid, projectname) {
	let uploadurls = [];
	let chunks = {};
	return bucket.getFiles({prefix: uid + '/' + projectname + '/', delimiter:'/', autoPaginate:false})
	.then(function (uploads) {
		//console.log('uploads', uploads[0]);
		let filereadstream = {};
		let promises = uploads[0].map(function (upload) {
			let fileurl = upload.name
			let filename = upload.name.split('/')[ upload.name.split('/').length - 1]
			let type = filename.replace(/^.*\.(.*)$/, "$1");
			let filetypes = ['html', 'css', 'js', 'htm'];
			if (filetypes.includes(type)) {
				return new Promise(function(resolve, reject) {
					//console.log('upload', filename);
					chunks[fileurl] = [];
					let file = bucket.file(upload.name);
					//console.log('file', file);
					return file.createReadStream()
					.on('data', function(data) {
						chunks[fileurl].push(data);
					})
					.on('finish', function() {
						//console.log('upload.name', Buffer.concat(chunks[upload.name]).toString('utf8'))
						let object = {name: filename, contents: Buffer.concat(chunks[upload.name]).toString('utf8'), uploaded: true}
						resolve(object);
						//return chunks[fileurl];
					})
					.on('error', function (err2) {
						//console.log(err2);
						reject(err2);
						//return err2;
					});		
				});
			}
		});
		return Promise.all(promises).then(function (uploaded) {
			return uploaded;
		})
	});
}

function searchfilefordependancies(globals, contents) {
	//console.log('globalfile', globals)
	let included = [];
	for (let i = 0; i < globals.length; i++) {
		//console.log(globals[file])
		if (contents.includes(globals[i].name)) {
			//console.log('includes', globals[file].name)
			included.push({name: globals[i].name, contents: globals[i].contents});
		}
	}
	if (!included) return false;
	return included;
}

function searchfordependancies(uid, filename, contents) {
	let globals = [];
	return nametoref(root.child('projects'), uid, 'global')
	.then(function (globalref) {
		return globalref.child('files').once('value');
	})
	.then (function (snapshot) {
		snapshot.forEach(function (file) {
			//console.log('name', file.val().name);
			globals.push({name: file.val().name, contents: file.val().contents});
		})
		return searchfilefordependancies(globals, contents)
	})
	.then(function (included) {
		return included;
	});
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
			//console.log('key', snap.key)
			result = snap;
		});
		if (!result) {
			throw 'ref not found';
		}
		//console.log('results', result.key, result.val());
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
			return findbucketfiles(uid, projectname)
			.then(function (uploads) {
				let files = snapshot.val();
				let results = [];
				if (files) {
					Object.values(files).forEach(function (file) {
						//console.log(snapshot.val());
						delete file.contents;
						//console.log('file', file)
						results.push(file);							
					});			
				}
				if (uploads) {
					Object.values(uploads).forEach(function (upload) {
						if (upload) {
							//console.log(snapshot.val());
							delete upload.contents;
							//console.log('file', file)
							results.push(upload);			
						}
					});			
				}
				//console.log('results', results);
				return JSON.stringify(results);
			});
		});
	} else {
		//console.log('.files');
		return ref.child(uid).orderByChild('lastchange').once('value')
		.then(function (snapshot) {
			let allprojects = [];
			snapshot.forEach(function (snap) {
				if (snap.val().name) {
					allprojects.unshift({'name': snap.val().settings.name, 'longname': snap.val().settings.longname, 'lastchange': snap.val().lastchange, 'archived': snap.val().settings.archived});
				}
			});
			return JSON.stringify(allprojects);
		});
	}
}

function findadminfile(ref, uid, filename) {
	//console.log('findadminfile', uid, filename);
	return nametoref(ref, uid, 'admin')
	.then(function (adminref){
		return nametoref(adminref, 'files', filename)
	})
	.then(function (fileref) {
		return fileref.once('value')
	})
	.then(function (snapshot) {
		return snapshot.val();
	});
}

function serve(req, res) {
	let query = req.query;
	let [host, uid, projectname, filename] = req.path.split('/')
	//console.log(uid, projectname);
	if (!filename) {
		//console.log('URL info:', host, uid, projectname, filename, query.run);
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
				//console.log('252', projectname, filename);
				createfilelist(projects, uid, projectname)
				.then(function (files) {
					//console.log('files', files);
					res.send(files);
				});
			} else if (!projectname) {
				if (query.run == 'download') {
					download(res, uid)					
				} else {
					//console.log('TABLE OF CONTENTS');
					projects.child('0GZ6h7paIPSfwN6kvMqxv85p9XX2').child('-LEboYpzmQHHIb9ABL73').child('files' ).child('-LFVYbMm1BjtqOW6vJpY').once('value', function (snapshot) {
						//console.log('toc');
						res.send(snapshot.val().contents);
					});
				}
			} else if (query.run == 'download') {
				//console.log('DOWNLOAD PROJECT');
				nametoid(projects, uid, projectname)
				.then(function (nametoid) {
					download(res, uid, nametoid, projectname)
				});
			} else if (query.run == 'viewer') {
				projects.child('global').child('-LFApck9n3U1YdCYWKEA').child('files' ).child('-LFVCiLyPZucebTpYwog').once('value', function (snapshot) {
					res.send(snapshot.val().contents);
				});				
			} else if (query.run == 'edit' || query.run == 'editor') {
				findadminfile(projects, '0GZ6h7paIPSfwN6kvMqxv85p9XX2', 'editor.html')
				.then(function (file) {					
					console.log('edit');
					nametoref(projects, uid, projectname)
					.then(function(projectref) {
						let timecode = Date.now();
						//console.log(timecode);
						//console.log('filename', filename);
						if (!filename) filename = '_html';
						//console.log('filename2', filename);
						projectref.child('activetab').update({name: filename, instance: timecode});							
						res.cookie('instance', timecode);
						//res.sendFile('editor.html', { root: __dirname + '/html'});
						//res.set('content-type', 'text/html');
						res.send(file.contents);					
					});
				});
			} else if (!filename) {
				console.log('run', filename);
				nametoref(projects, uid, projectname)
				.then(projectref => projectref.once('value'))
				.then(function (snapshot) {
					if (true || !snapshot.val().settings.archived) {
						res.send(snapshot.val().contents);
					}
				});
			} else if (filename) {
				//console.log('DEPENDANCY');
				if (query.create) {
					createquery(res, projects, query, uid, projectname, filename)
				} else {
					let ref;
					nametoref(projects, uid, projectname)
					.then(function (projectref) {
						ref = projectref;
						nametoref(projectref, 'files', filename)
						.then(function (fileref) {
							fileref.once('value', function (snapshot) {
								if (snapshot.val().archived) {								
									checkglobalfiles(projects, uid, filename)
									.then(function (file) {
										console.log('global', file.name);
										sendwithtype(res, projects, uid, projectname, file.name, file.contents);							
									})
								} else {
									if (filename.charAt(0) != '.') {
										console.log('local', uid, projectname, snapshot.val().name);
										sendwithtype(res, projects, uid, projectname, snapshot.val().name, snapshot.val().contents);															
									} else res.send(snapshot.val().contents);
								}
							});
						})
						.catch(function (err) {
							checkglobalfiles(projects, uid, filename)
							.then(function(file) {
								console.log('global', file.name);
								//sendwithtype(res, projects, uid, projectname, file.name, file.contents);	
								res.send(file.contents)
							})
							.catch(function(error) {
								let file = bucket.file('/' + uid + '/' + projectname + '/' + filename);
								let filereadstream = file.createReadStream();
								filereadstream.pipe(res);
								console.log('bucket', filename);
								filereadstream.on('error', function (err2) {
									console.log(err2);
									console.log('buckert', uid, projectname, filename);
								});
							});
						});
					});
				}
			} else {
				res.status(404)
				res.send('Not found')			
			}
		}
	});
}

function createquery(res, ref, query, uid, projectname, filename) {
	let projects = ref;
	if (query.create == 'yes') {
		console.log('1')
		nametoref(ref, '0GZ6h7paIPSfwN6kvMqxv85p9XX2', 'admin')
		.then(function (adminref) {
			console.log('2')
			nametoobject(adminref, 'files', 'template.html')
			.then(function (fileobj) {
				console.log('3')
				nametoref(projects, uid, projectname)
				.then(function (projectref) {
					projectref.child('files').push({
						contents: fileobj.contents,
						name: filename,
						lastchange: firebase.database.ServerValue.TIMESTAMP,
					});
					sendwithtype(res, ref, uid, projectname, filename, fileobj.contents);					
				});
			});								
		})
	} else if (query.create == 'maybe') {
		nametoref(ref, '0GZ6h7paIPSfwN6kvMqxv85p9XX2', 'admin')
		.then(adminref => nametoobject(adminref, 'files', 'notfound.html'))
		.then(function (fileobj){
			res.send(fileobj.contents);
		});
	} else {
		res.status(404)
		console.log(uid, projectname);
		res.send('Not found')											
	}
}

function checkglobalfiles(ref, uid, filename) {
	return nametoref(ref, uid, 'global')
	.then(function (globalref) {
		return nametoref(globalref, 'files', filename)
	})
	.then(function (fileref) {
		return fileref.once('value')
	})
	.then(function (snapshot) {
		return snapshot.val();
	})
	.catch(function (err) {
		throw 'file not found';
	});
}

function sendwithtype(res, ref, uid, projectname, name, contents) {
	let type = name.replace(/^.*\.(.*)$/, "$1");
	//console.log('type', type, uid, name);
	if (type == 'js') {type = 'javascript'};
	if (type == 'htm') {type = 'html'};
	if (type == 'html') {
		nametoref(ref, uid, projectname)
		.then(function(projectref) {
			let timecode = Date.now();
			projectref.child('activetab').update({name: name, instance: 'none'});							
		})
	}
	res.set('content-type', 'text/'+type);
	res.send(contents);							
}
















