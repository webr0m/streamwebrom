document.querySelector('#connect').onsubmit=async e=>{
  e.preventDefault();const error=document.querySelector('#error');error.textContent='';
  try{await window.captureHome.connect(document.querySelector('#address').value.trim())}catch(err){error.textContent=err.message}
};
