
var currentChargingPower, avgSurplusPower;

const reservedExcess = 100; // reserved power (in Watt) to insert into the grid as safety buffer
const numberSamples = 60; //Number of values for calculating average
const minAmpere = 6;
const maxAmpere = 16;
var threePhase = false; //start with one-phase charging
var list  = new Array(numberSamples);
var excessPower = 0;

//calculate excess power every second
schedule('* * * * * *', calcExcess);

//check if charging speed needs to be modified every 2 minutes
schedule('*/2 * * * *', setWallbox);

currentChargingPower = 0;
list.fill(getCurrentSurplus());

//initialize in case wallbox is already charging when script is started
if (getState("easee.0.EH8XMF8C.status.chargerOpMode").val == 3) {
    var voltage = getState('easee.0.EH8XMF8C.status.voltage').val;
    currentChargingPower = getState("easee.0.EH8XMF8C.config.dynamicCircuitCurrentP1").val * voltage
        + getState("easee.0.EH8XMF8C.config.dynamicCircuitCurrentP2").val * voltage
        + getState("easee.0.EH8XMF8C.config.dynamicCircuitCurrentP3").val * voltage
    
    if(currentChargingPower > 3800) {
        threePhase = true;
    }
}

console.log("Started PV excess power wallbox charging script. Updates to the wallbox will be attempted every 2 Minutes. Please stand by...");


function calcExcess() {
    //calculate if we we have surplus or shortage
    var currentSurplus = getCurrentSurplus();
    
    list.shift();
    list.push(currentSurplus);
    let sum = list.reduce(function(a, b){
        return a + b;
    });
    avgSurplusPower = Math.round(sum/numberSamples);

    excessPower = Math.round(currentChargingPower + avgSurplusPower);

    //console.log("Excess power: "+excessPower+" W");
}

function setWallbox() {
    //chargerOpMode = Offline: 0, Disconnected: 1, AwaitingStart: 2, Charging: 3, Completed: 4, Error: 5, ReadyToCharge: 6
    var wallboxMode = getState("easee.0.EH8XMF8C.status.chargerOpMode").val;
    console.log("Checking if charging speed needs to be adapted.")
    if(excessPower > 2000) {
        // if there is more that 2 kW excess power we start charging

        if (wallboxMode == 0) {
            console.log("There is PV excess power but the wallbox is offline!");
            return;
        }
        if (wallboxMode == 1) {
            console.log("There is PV excess power but the wallbox is disconnected!");
            return;
        }
        if (wallboxMode == 4) {
            console.log("There is PV excess power but the charging process is completed.");
            return;
        }
        if (wallboxMode == 5) {
            console.log("There is PV excess power but the wallbox has an error!");
            return;
        }

        var voltage = getState('easee.0.EH8XMF8C.status.voltage').val;

        if(threePhase) {
            //charging on all 3 phases
            var ampere = Math.min(Math.round((excessPower/3)/voltage), maxAmpere);
            ampere = Math.max(ampere, minAmpere);

            if((voltage * ampere * 3) != currentChargingPower) {
                currentChargingPower = Math.round(voltage * ampere * 3);
                setState("easee.0.EH8XMF8C.config.dynamicCircuitCurrentP1", ampere);
                setState("easee.0.EH8XMF8C.config.dynamicCircuitCurrentP2", ampere);
                setState("easee.0.EH8XMF8C.config.dynamicCircuitCurrentP3", ampere);

                console.log('Three-Phase charging now at '+ampere+' Ampere ('+ (currentChargingPower/1000).toFixed(1) +' kW)');
                //set list to 0 to reset avg access
                list.fill(0);
            }

            //re-evaluate phase
            if(excessPower < 4000) {
                threePhase = false;
            }

        } else {
            //charging on 1 phase only
            var ampere = Math.min(Math.round(excessPower/voltage), maxAmpere);
            ampere = Math.max(ampere, minAmpere);
            
            if((voltage * ampere) != currentChargingPower) {
                currentChargingPower =  Math.round(voltage * ampere);

                setState("easee.0.EH8XMF8C.config.dynamicCircuitCurrentP1", ampere);
                setState("easee.0.EH8XMF8C.config.dynamicCircuitCurrentP2", 0);
                setState("easee.0.EH8XMF8C.config.dynamicCircuitCurrentP3", 0);

                console.log('One-Phase charging now at '+ampere+' Ampere ('+ (currentChargingPower/1000).toFixed(1) +' kW)');
                //set list to 0 to reset avg access
                list.fill(0);
            }

            //re-evaluate phase
            if(excessPower > 4500) {
                threePhase = true;
            }
        }

        //start charging
        if (getState("easee.0.EH8XMF8C.status.chargerOpMode").val != 3) {
            console.log(('PV excess charging started!'));
            setState("easee.0.EH8XMF8C.control.resume", true);
            setState("easee.0.EH8XMF8C.control.start", true);
        }

        console.log('Charging at '+(currentChargingPower/1000).toFixed(1) +' kW, excess power at: ' + excessPower + " W.");
        
    } else {
        console.log('Not charging, excess power too low: ' + excessPower + " W.");
        //stop charging
        if (getState("easee.0.EH8XMF8C.status.chargerOpMode").val == 3) {
            console.log(('PV excess charging stopped!'));
            setState("easee.0.EH8XMF8C.config.dynamicCircuitCurrentP1", 0);
            setState("easee.0.EH8XMF8C.config.dynamicCircuitCurrentP2", 0);
            setState("easee.0.EH8XMF8C.config.dynamicCircuitCurrentP3", 0);
            setState("easee.0.EH8XMF8C.control.pause", true);
            setState("easee.0.EH8XMF8C.control.stop", true);
        }
        currentChargingPower = 0;
    }
}

function getCurrentSurplus() {
    return getState('javascript.0.PV.surplus').val - reservedExcess - getState('javascript.0.PV.regard').val;
}
