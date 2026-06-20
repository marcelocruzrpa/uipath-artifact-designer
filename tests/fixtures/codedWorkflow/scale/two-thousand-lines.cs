// Fixture: ~2000-line scale guardrail input. GENERATED ONCE by the snippet
// below and committed — do not regenerate casually, tests assert its exact
// statement accounting.
//
//   const blocks = [];
//   for (let i = 1; i <= 230; i += 1) {
//     blocks.push([
//       `            Log("step ${i} start");`,
//       `            var value${i} = system.GetAsset("Asset${i}");`,
//       `            counter = counter + ${i};`,
//       `            if (counter > ${i})`,
//       `            {`,
//       `                Log("step ${i} hot");`,
//       `                counter = counter - 1;`,
//       `            }`,
//       `            total = total + counter;`
//     ].join("\n"));
//   }
using System;
using UiPath.CodedWorkflows;

namespace Acme.Scale
{
    public class TwoThousandLines : CodedWorkflow
    {
        [Workflow]
        public void Execute()
        {
            var counter = 0;
            var total = 0;
            Log("step 1 start");
            var value1 = system.GetAsset("Asset1");
            counter = counter + 1;
            if (counter > 1)
            {
                Log("step 1 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 2 start");
            var value2 = system.GetAsset("Asset2");
            counter = counter + 2;
            if (counter > 2)
            {
                Log("step 2 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 3 start");
            var value3 = system.GetAsset("Asset3");
            counter = counter + 3;
            if (counter > 3)
            {
                Log("step 3 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 4 start");
            var value4 = system.GetAsset("Asset4");
            counter = counter + 4;
            if (counter > 4)
            {
                Log("step 4 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 5 start");
            var value5 = system.GetAsset("Asset5");
            counter = counter + 5;
            if (counter > 5)
            {
                Log("step 5 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 6 start");
            var value6 = system.GetAsset("Asset6");
            counter = counter + 6;
            if (counter > 6)
            {
                Log("step 6 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 7 start");
            var value7 = system.GetAsset("Asset7");
            counter = counter + 7;
            if (counter > 7)
            {
                Log("step 7 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 8 start");
            var value8 = system.GetAsset("Asset8");
            counter = counter + 8;
            if (counter > 8)
            {
                Log("step 8 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 9 start");
            var value9 = system.GetAsset("Asset9");
            counter = counter + 9;
            if (counter > 9)
            {
                Log("step 9 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 10 start");
            var value10 = system.GetAsset("Asset10");
            counter = counter + 10;
            if (counter > 10)
            {
                Log("step 10 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 11 start");
            var value11 = system.GetAsset("Asset11");
            counter = counter + 11;
            if (counter > 11)
            {
                Log("step 11 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 12 start");
            var value12 = system.GetAsset("Asset12");
            counter = counter + 12;
            if (counter > 12)
            {
                Log("step 12 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 13 start");
            var value13 = system.GetAsset("Asset13");
            counter = counter + 13;
            if (counter > 13)
            {
                Log("step 13 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 14 start");
            var value14 = system.GetAsset("Asset14");
            counter = counter + 14;
            if (counter > 14)
            {
                Log("step 14 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 15 start");
            var value15 = system.GetAsset("Asset15");
            counter = counter + 15;
            if (counter > 15)
            {
                Log("step 15 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 16 start");
            var value16 = system.GetAsset("Asset16");
            counter = counter + 16;
            if (counter > 16)
            {
                Log("step 16 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 17 start");
            var value17 = system.GetAsset("Asset17");
            counter = counter + 17;
            if (counter > 17)
            {
                Log("step 17 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 18 start");
            var value18 = system.GetAsset("Asset18");
            counter = counter + 18;
            if (counter > 18)
            {
                Log("step 18 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 19 start");
            var value19 = system.GetAsset("Asset19");
            counter = counter + 19;
            if (counter > 19)
            {
                Log("step 19 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 20 start");
            var value20 = system.GetAsset("Asset20");
            counter = counter + 20;
            if (counter > 20)
            {
                Log("step 20 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 21 start");
            var value21 = system.GetAsset("Asset21");
            counter = counter + 21;
            if (counter > 21)
            {
                Log("step 21 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 22 start");
            var value22 = system.GetAsset("Asset22");
            counter = counter + 22;
            if (counter > 22)
            {
                Log("step 22 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 23 start");
            var value23 = system.GetAsset("Asset23");
            counter = counter + 23;
            if (counter > 23)
            {
                Log("step 23 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 24 start");
            var value24 = system.GetAsset("Asset24");
            counter = counter + 24;
            if (counter > 24)
            {
                Log("step 24 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 25 start");
            var value25 = system.GetAsset("Asset25");
            counter = counter + 25;
            if (counter > 25)
            {
                Log("step 25 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 26 start");
            var value26 = system.GetAsset("Asset26");
            counter = counter + 26;
            if (counter > 26)
            {
                Log("step 26 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 27 start");
            var value27 = system.GetAsset("Asset27");
            counter = counter + 27;
            if (counter > 27)
            {
                Log("step 27 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 28 start");
            var value28 = system.GetAsset("Asset28");
            counter = counter + 28;
            if (counter > 28)
            {
                Log("step 28 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 29 start");
            var value29 = system.GetAsset("Asset29");
            counter = counter + 29;
            if (counter > 29)
            {
                Log("step 29 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 30 start");
            var value30 = system.GetAsset("Asset30");
            counter = counter + 30;
            if (counter > 30)
            {
                Log("step 30 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 31 start");
            var value31 = system.GetAsset("Asset31");
            counter = counter + 31;
            if (counter > 31)
            {
                Log("step 31 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 32 start");
            var value32 = system.GetAsset("Asset32");
            counter = counter + 32;
            if (counter > 32)
            {
                Log("step 32 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 33 start");
            var value33 = system.GetAsset("Asset33");
            counter = counter + 33;
            if (counter > 33)
            {
                Log("step 33 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 34 start");
            var value34 = system.GetAsset("Asset34");
            counter = counter + 34;
            if (counter > 34)
            {
                Log("step 34 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 35 start");
            var value35 = system.GetAsset("Asset35");
            counter = counter + 35;
            if (counter > 35)
            {
                Log("step 35 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 36 start");
            var value36 = system.GetAsset("Asset36");
            counter = counter + 36;
            if (counter > 36)
            {
                Log("step 36 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 37 start");
            var value37 = system.GetAsset("Asset37");
            counter = counter + 37;
            if (counter > 37)
            {
                Log("step 37 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 38 start");
            var value38 = system.GetAsset("Asset38");
            counter = counter + 38;
            if (counter > 38)
            {
                Log("step 38 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 39 start");
            var value39 = system.GetAsset("Asset39");
            counter = counter + 39;
            if (counter > 39)
            {
                Log("step 39 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 40 start");
            var value40 = system.GetAsset("Asset40");
            counter = counter + 40;
            if (counter > 40)
            {
                Log("step 40 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 41 start");
            var value41 = system.GetAsset("Asset41");
            counter = counter + 41;
            if (counter > 41)
            {
                Log("step 41 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 42 start");
            var value42 = system.GetAsset("Asset42");
            counter = counter + 42;
            if (counter > 42)
            {
                Log("step 42 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 43 start");
            var value43 = system.GetAsset("Asset43");
            counter = counter + 43;
            if (counter > 43)
            {
                Log("step 43 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 44 start");
            var value44 = system.GetAsset("Asset44");
            counter = counter + 44;
            if (counter > 44)
            {
                Log("step 44 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 45 start");
            var value45 = system.GetAsset("Asset45");
            counter = counter + 45;
            if (counter > 45)
            {
                Log("step 45 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 46 start");
            var value46 = system.GetAsset("Asset46");
            counter = counter + 46;
            if (counter > 46)
            {
                Log("step 46 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 47 start");
            var value47 = system.GetAsset("Asset47");
            counter = counter + 47;
            if (counter > 47)
            {
                Log("step 47 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 48 start");
            var value48 = system.GetAsset("Asset48");
            counter = counter + 48;
            if (counter > 48)
            {
                Log("step 48 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 49 start");
            var value49 = system.GetAsset("Asset49");
            counter = counter + 49;
            if (counter > 49)
            {
                Log("step 49 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 50 start");
            var value50 = system.GetAsset("Asset50");
            counter = counter + 50;
            if (counter > 50)
            {
                Log("step 50 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 51 start");
            var value51 = system.GetAsset("Asset51");
            counter = counter + 51;
            if (counter > 51)
            {
                Log("step 51 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 52 start");
            var value52 = system.GetAsset("Asset52");
            counter = counter + 52;
            if (counter > 52)
            {
                Log("step 52 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 53 start");
            var value53 = system.GetAsset("Asset53");
            counter = counter + 53;
            if (counter > 53)
            {
                Log("step 53 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 54 start");
            var value54 = system.GetAsset("Asset54");
            counter = counter + 54;
            if (counter > 54)
            {
                Log("step 54 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 55 start");
            var value55 = system.GetAsset("Asset55");
            counter = counter + 55;
            if (counter > 55)
            {
                Log("step 55 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 56 start");
            var value56 = system.GetAsset("Asset56");
            counter = counter + 56;
            if (counter > 56)
            {
                Log("step 56 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 57 start");
            var value57 = system.GetAsset("Asset57");
            counter = counter + 57;
            if (counter > 57)
            {
                Log("step 57 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 58 start");
            var value58 = system.GetAsset("Asset58");
            counter = counter + 58;
            if (counter > 58)
            {
                Log("step 58 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 59 start");
            var value59 = system.GetAsset("Asset59");
            counter = counter + 59;
            if (counter > 59)
            {
                Log("step 59 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 60 start");
            var value60 = system.GetAsset("Asset60");
            counter = counter + 60;
            if (counter > 60)
            {
                Log("step 60 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 61 start");
            var value61 = system.GetAsset("Asset61");
            counter = counter + 61;
            if (counter > 61)
            {
                Log("step 61 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 62 start");
            var value62 = system.GetAsset("Asset62");
            counter = counter + 62;
            if (counter > 62)
            {
                Log("step 62 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 63 start");
            var value63 = system.GetAsset("Asset63");
            counter = counter + 63;
            if (counter > 63)
            {
                Log("step 63 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 64 start");
            var value64 = system.GetAsset("Asset64");
            counter = counter + 64;
            if (counter > 64)
            {
                Log("step 64 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 65 start");
            var value65 = system.GetAsset("Asset65");
            counter = counter + 65;
            if (counter > 65)
            {
                Log("step 65 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 66 start");
            var value66 = system.GetAsset("Asset66");
            counter = counter + 66;
            if (counter > 66)
            {
                Log("step 66 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 67 start");
            var value67 = system.GetAsset("Asset67");
            counter = counter + 67;
            if (counter > 67)
            {
                Log("step 67 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 68 start");
            var value68 = system.GetAsset("Asset68");
            counter = counter + 68;
            if (counter > 68)
            {
                Log("step 68 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 69 start");
            var value69 = system.GetAsset("Asset69");
            counter = counter + 69;
            if (counter > 69)
            {
                Log("step 69 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 70 start");
            var value70 = system.GetAsset("Asset70");
            counter = counter + 70;
            if (counter > 70)
            {
                Log("step 70 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 71 start");
            var value71 = system.GetAsset("Asset71");
            counter = counter + 71;
            if (counter > 71)
            {
                Log("step 71 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 72 start");
            var value72 = system.GetAsset("Asset72");
            counter = counter + 72;
            if (counter > 72)
            {
                Log("step 72 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 73 start");
            var value73 = system.GetAsset("Asset73");
            counter = counter + 73;
            if (counter > 73)
            {
                Log("step 73 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 74 start");
            var value74 = system.GetAsset("Asset74");
            counter = counter + 74;
            if (counter > 74)
            {
                Log("step 74 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 75 start");
            var value75 = system.GetAsset("Asset75");
            counter = counter + 75;
            if (counter > 75)
            {
                Log("step 75 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 76 start");
            var value76 = system.GetAsset("Asset76");
            counter = counter + 76;
            if (counter > 76)
            {
                Log("step 76 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 77 start");
            var value77 = system.GetAsset("Asset77");
            counter = counter + 77;
            if (counter > 77)
            {
                Log("step 77 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 78 start");
            var value78 = system.GetAsset("Asset78");
            counter = counter + 78;
            if (counter > 78)
            {
                Log("step 78 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 79 start");
            var value79 = system.GetAsset("Asset79");
            counter = counter + 79;
            if (counter > 79)
            {
                Log("step 79 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 80 start");
            var value80 = system.GetAsset("Asset80");
            counter = counter + 80;
            if (counter > 80)
            {
                Log("step 80 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 81 start");
            var value81 = system.GetAsset("Asset81");
            counter = counter + 81;
            if (counter > 81)
            {
                Log("step 81 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 82 start");
            var value82 = system.GetAsset("Asset82");
            counter = counter + 82;
            if (counter > 82)
            {
                Log("step 82 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 83 start");
            var value83 = system.GetAsset("Asset83");
            counter = counter + 83;
            if (counter > 83)
            {
                Log("step 83 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 84 start");
            var value84 = system.GetAsset("Asset84");
            counter = counter + 84;
            if (counter > 84)
            {
                Log("step 84 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 85 start");
            var value85 = system.GetAsset("Asset85");
            counter = counter + 85;
            if (counter > 85)
            {
                Log("step 85 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 86 start");
            var value86 = system.GetAsset("Asset86");
            counter = counter + 86;
            if (counter > 86)
            {
                Log("step 86 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 87 start");
            var value87 = system.GetAsset("Asset87");
            counter = counter + 87;
            if (counter > 87)
            {
                Log("step 87 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 88 start");
            var value88 = system.GetAsset("Asset88");
            counter = counter + 88;
            if (counter > 88)
            {
                Log("step 88 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 89 start");
            var value89 = system.GetAsset("Asset89");
            counter = counter + 89;
            if (counter > 89)
            {
                Log("step 89 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 90 start");
            var value90 = system.GetAsset("Asset90");
            counter = counter + 90;
            if (counter > 90)
            {
                Log("step 90 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 91 start");
            var value91 = system.GetAsset("Asset91");
            counter = counter + 91;
            if (counter > 91)
            {
                Log("step 91 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 92 start");
            var value92 = system.GetAsset("Asset92");
            counter = counter + 92;
            if (counter > 92)
            {
                Log("step 92 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 93 start");
            var value93 = system.GetAsset("Asset93");
            counter = counter + 93;
            if (counter > 93)
            {
                Log("step 93 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 94 start");
            var value94 = system.GetAsset("Asset94");
            counter = counter + 94;
            if (counter > 94)
            {
                Log("step 94 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 95 start");
            var value95 = system.GetAsset("Asset95");
            counter = counter + 95;
            if (counter > 95)
            {
                Log("step 95 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 96 start");
            var value96 = system.GetAsset("Asset96");
            counter = counter + 96;
            if (counter > 96)
            {
                Log("step 96 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 97 start");
            var value97 = system.GetAsset("Asset97");
            counter = counter + 97;
            if (counter > 97)
            {
                Log("step 97 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 98 start");
            var value98 = system.GetAsset("Asset98");
            counter = counter + 98;
            if (counter > 98)
            {
                Log("step 98 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 99 start");
            var value99 = system.GetAsset("Asset99");
            counter = counter + 99;
            if (counter > 99)
            {
                Log("step 99 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 100 start");
            var value100 = system.GetAsset("Asset100");
            counter = counter + 100;
            if (counter > 100)
            {
                Log("step 100 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 101 start");
            var value101 = system.GetAsset("Asset101");
            counter = counter + 101;
            if (counter > 101)
            {
                Log("step 101 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 102 start");
            var value102 = system.GetAsset("Asset102");
            counter = counter + 102;
            if (counter > 102)
            {
                Log("step 102 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 103 start");
            var value103 = system.GetAsset("Asset103");
            counter = counter + 103;
            if (counter > 103)
            {
                Log("step 103 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 104 start");
            var value104 = system.GetAsset("Asset104");
            counter = counter + 104;
            if (counter > 104)
            {
                Log("step 104 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 105 start");
            var value105 = system.GetAsset("Asset105");
            counter = counter + 105;
            if (counter > 105)
            {
                Log("step 105 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 106 start");
            var value106 = system.GetAsset("Asset106");
            counter = counter + 106;
            if (counter > 106)
            {
                Log("step 106 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 107 start");
            var value107 = system.GetAsset("Asset107");
            counter = counter + 107;
            if (counter > 107)
            {
                Log("step 107 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 108 start");
            var value108 = system.GetAsset("Asset108");
            counter = counter + 108;
            if (counter > 108)
            {
                Log("step 108 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 109 start");
            var value109 = system.GetAsset("Asset109");
            counter = counter + 109;
            if (counter > 109)
            {
                Log("step 109 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 110 start");
            var value110 = system.GetAsset("Asset110");
            counter = counter + 110;
            if (counter > 110)
            {
                Log("step 110 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 111 start");
            var value111 = system.GetAsset("Asset111");
            counter = counter + 111;
            if (counter > 111)
            {
                Log("step 111 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 112 start");
            var value112 = system.GetAsset("Asset112");
            counter = counter + 112;
            if (counter > 112)
            {
                Log("step 112 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 113 start");
            var value113 = system.GetAsset("Asset113");
            counter = counter + 113;
            if (counter > 113)
            {
                Log("step 113 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 114 start");
            var value114 = system.GetAsset("Asset114");
            counter = counter + 114;
            if (counter > 114)
            {
                Log("step 114 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 115 start");
            var value115 = system.GetAsset("Asset115");
            counter = counter + 115;
            if (counter > 115)
            {
                Log("step 115 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 116 start");
            var value116 = system.GetAsset("Asset116");
            counter = counter + 116;
            if (counter > 116)
            {
                Log("step 116 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 117 start");
            var value117 = system.GetAsset("Asset117");
            counter = counter + 117;
            if (counter > 117)
            {
                Log("step 117 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 118 start");
            var value118 = system.GetAsset("Asset118");
            counter = counter + 118;
            if (counter > 118)
            {
                Log("step 118 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 119 start");
            var value119 = system.GetAsset("Asset119");
            counter = counter + 119;
            if (counter > 119)
            {
                Log("step 119 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 120 start");
            var value120 = system.GetAsset("Asset120");
            counter = counter + 120;
            if (counter > 120)
            {
                Log("step 120 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 121 start");
            var value121 = system.GetAsset("Asset121");
            counter = counter + 121;
            if (counter > 121)
            {
                Log("step 121 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 122 start");
            var value122 = system.GetAsset("Asset122");
            counter = counter + 122;
            if (counter > 122)
            {
                Log("step 122 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 123 start");
            var value123 = system.GetAsset("Asset123");
            counter = counter + 123;
            if (counter > 123)
            {
                Log("step 123 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 124 start");
            var value124 = system.GetAsset("Asset124");
            counter = counter + 124;
            if (counter > 124)
            {
                Log("step 124 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 125 start");
            var value125 = system.GetAsset("Asset125");
            counter = counter + 125;
            if (counter > 125)
            {
                Log("step 125 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 126 start");
            var value126 = system.GetAsset("Asset126");
            counter = counter + 126;
            if (counter > 126)
            {
                Log("step 126 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 127 start");
            var value127 = system.GetAsset("Asset127");
            counter = counter + 127;
            if (counter > 127)
            {
                Log("step 127 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 128 start");
            var value128 = system.GetAsset("Asset128");
            counter = counter + 128;
            if (counter > 128)
            {
                Log("step 128 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 129 start");
            var value129 = system.GetAsset("Asset129");
            counter = counter + 129;
            if (counter > 129)
            {
                Log("step 129 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 130 start");
            var value130 = system.GetAsset("Asset130");
            counter = counter + 130;
            if (counter > 130)
            {
                Log("step 130 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 131 start");
            var value131 = system.GetAsset("Asset131");
            counter = counter + 131;
            if (counter > 131)
            {
                Log("step 131 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 132 start");
            var value132 = system.GetAsset("Asset132");
            counter = counter + 132;
            if (counter > 132)
            {
                Log("step 132 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 133 start");
            var value133 = system.GetAsset("Asset133");
            counter = counter + 133;
            if (counter > 133)
            {
                Log("step 133 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 134 start");
            var value134 = system.GetAsset("Asset134");
            counter = counter + 134;
            if (counter > 134)
            {
                Log("step 134 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 135 start");
            var value135 = system.GetAsset("Asset135");
            counter = counter + 135;
            if (counter > 135)
            {
                Log("step 135 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 136 start");
            var value136 = system.GetAsset("Asset136");
            counter = counter + 136;
            if (counter > 136)
            {
                Log("step 136 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 137 start");
            var value137 = system.GetAsset("Asset137");
            counter = counter + 137;
            if (counter > 137)
            {
                Log("step 137 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 138 start");
            var value138 = system.GetAsset("Asset138");
            counter = counter + 138;
            if (counter > 138)
            {
                Log("step 138 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 139 start");
            var value139 = system.GetAsset("Asset139");
            counter = counter + 139;
            if (counter > 139)
            {
                Log("step 139 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 140 start");
            var value140 = system.GetAsset("Asset140");
            counter = counter + 140;
            if (counter > 140)
            {
                Log("step 140 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 141 start");
            var value141 = system.GetAsset("Asset141");
            counter = counter + 141;
            if (counter > 141)
            {
                Log("step 141 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 142 start");
            var value142 = system.GetAsset("Asset142");
            counter = counter + 142;
            if (counter > 142)
            {
                Log("step 142 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 143 start");
            var value143 = system.GetAsset("Asset143");
            counter = counter + 143;
            if (counter > 143)
            {
                Log("step 143 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 144 start");
            var value144 = system.GetAsset("Asset144");
            counter = counter + 144;
            if (counter > 144)
            {
                Log("step 144 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 145 start");
            var value145 = system.GetAsset("Asset145");
            counter = counter + 145;
            if (counter > 145)
            {
                Log("step 145 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 146 start");
            var value146 = system.GetAsset("Asset146");
            counter = counter + 146;
            if (counter > 146)
            {
                Log("step 146 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 147 start");
            var value147 = system.GetAsset("Asset147");
            counter = counter + 147;
            if (counter > 147)
            {
                Log("step 147 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 148 start");
            var value148 = system.GetAsset("Asset148");
            counter = counter + 148;
            if (counter > 148)
            {
                Log("step 148 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 149 start");
            var value149 = system.GetAsset("Asset149");
            counter = counter + 149;
            if (counter > 149)
            {
                Log("step 149 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 150 start");
            var value150 = system.GetAsset("Asset150");
            counter = counter + 150;
            if (counter > 150)
            {
                Log("step 150 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 151 start");
            var value151 = system.GetAsset("Asset151");
            counter = counter + 151;
            if (counter > 151)
            {
                Log("step 151 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 152 start");
            var value152 = system.GetAsset("Asset152");
            counter = counter + 152;
            if (counter > 152)
            {
                Log("step 152 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 153 start");
            var value153 = system.GetAsset("Asset153");
            counter = counter + 153;
            if (counter > 153)
            {
                Log("step 153 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 154 start");
            var value154 = system.GetAsset("Asset154");
            counter = counter + 154;
            if (counter > 154)
            {
                Log("step 154 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 155 start");
            var value155 = system.GetAsset("Asset155");
            counter = counter + 155;
            if (counter > 155)
            {
                Log("step 155 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 156 start");
            var value156 = system.GetAsset("Asset156");
            counter = counter + 156;
            if (counter > 156)
            {
                Log("step 156 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 157 start");
            var value157 = system.GetAsset("Asset157");
            counter = counter + 157;
            if (counter > 157)
            {
                Log("step 157 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 158 start");
            var value158 = system.GetAsset("Asset158");
            counter = counter + 158;
            if (counter > 158)
            {
                Log("step 158 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 159 start");
            var value159 = system.GetAsset("Asset159");
            counter = counter + 159;
            if (counter > 159)
            {
                Log("step 159 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 160 start");
            var value160 = system.GetAsset("Asset160");
            counter = counter + 160;
            if (counter > 160)
            {
                Log("step 160 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 161 start");
            var value161 = system.GetAsset("Asset161");
            counter = counter + 161;
            if (counter > 161)
            {
                Log("step 161 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 162 start");
            var value162 = system.GetAsset("Asset162");
            counter = counter + 162;
            if (counter > 162)
            {
                Log("step 162 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 163 start");
            var value163 = system.GetAsset("Asset163");
            counter = counter + 163;
            if (counter > 163)
            {
                Log("step 163 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 164 start");
            var value164 = system.GetAsset("Asset164");
            counter = counter + 164;
            if (counter > 164)
            {
                Log("step 164 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 165 start");
            var value165 = system.GetAsset("Asset165");
            counter = counter + 165;
            if (counter > 165)
            {
                Log("step 165 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 166 start");
            var value166 = system.GetAsset("Asset166");
            counter = counter + 166;
            if (counter > 166)
            {
                Log("step 166 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 167 start");
            var value167 = system.GetAsset("Asset167");
            counter = counter + 167;
            if (counter > 167)
            {
                Log("step 167 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 168 start");
            var value168 = system.GetAsset("Asset168");
            counter = counter + 168;
            if (counter > 168)
            {
                Log("step 168 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 169 start");
            var value169 = system.GetAsset("Asset169");
            counter = counter + 169;
            if (counter > 169)
            {
                Log("step 169 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 170 start");
            var value170 = system.GetAsset("Asset170");
            counter = counter + 170;
            if (counter > 170)
            {
                Log("step 170 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 171 start");
            var value171 = system.GetAsset("Asset171");
            counter = counter + 171;
            if (counter > 171)
            {
                Log("step 171 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 172 start");
            var value172 = system.GetAsset("Asset172");
            counter = counter + 172;
            if (counter > 172)
            {
                Log("step 172 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 173 start");
            var value173 = system.GetAsset("Asset173");
            counter = counter + 173;
            if (counter > 173)
            {
                Log("step 173 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 174 start");
            var value174 = system.GetAsset("Asset174");
            counter = counter + 174;
            if (counter > 174)
            {
                Log("step 174 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 175 start");
            var value175 = system.GetAsset("Asset175");
            counter = counter + 175;
            if (counter > 175)
            {
                Log("step 175 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 176 start");
            var value176 = system.GetAsset("Asset176");
            counter = counter + 176;
            if (counter > 176)
            {
                Log("step 176 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 177 start");
            var value177 = system.GetAsset("Asset177");
            counter = counter + 177;
            if (counter > 177)
            {
                Log("step 177 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 178 start");
            var value178 = system.GetAsset("Asset178");
            counter = counter + 178;
            if (counter > 178)
            {
                Log("step 178 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 179 start");
            var value179 = system.GetAsset("Asset179");
            counter = counter + 179;
            if (counter > 179)
            {
                Log("step 179 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 180 start");
            var value180 = system.GetAsset("Asset180");
            counter = counter + 180;
            if (counter > 180)
            {
                Log("step 180 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 181 start");
            var value181 = system.GetAsset("Asset181");
            counter = counter + 181;
            if (counter > 181)
            {
                Log("step 181 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 182 start");
            var value182 = system.GetAsset("Asset182");
            counter = counter + 182;
            if (counter > 182)
            {
                Log("step 182 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 183 start");
            var value183 = system.GetAsset("Asset183");
            counter = counter + 183;
            if (counter > 183)
            {
                Log("step 183 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 184 start");
            var value184 = system.GetAsset("Asset184");
            counter = counter + 184;
            if (counter > 184)
            {
                Log("step 184 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 185 start");
            var value185 = system.GetAsset("Asset185");
            counter = counter + 185;
            if (counter > 185)
            {
                Log("step 185 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 186 start");
            var value186 = system.GetAsset("Asset186");
            counter = counter + 186;
            if (counter > 186)
            {
                Log("step 186 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 187 start");
            var value187 = system.GetAsset("Asset187");
            counter = counter + 187;
            if (counter > 187)
            {
                Log("step 187 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 188 start");
            var value188 = system.GetAsset("Asset188");
            counter = counter + 188;
            if (counter > 188)
            {
                Log("step 188 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 189 start");
            var value189 = system.GetAsset("Asset189");
            counter = counter + 189;
            if (counter > 189)
            {
                Log("step 189 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 190 start");
            var value190 = system.GetAsset("Asset190");
            counter = counter + 190;
            if (counter > 190)
            {
                Log("step 190 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 191 start");
            var value191 = system.GetAsset("Asset191");
            counter = counter + 191;
            if (counter > 191)
            {
                Log("step 191 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 192 start");
            var value192 = system.GetAsset("Asset192");
            counter = counter + 192;
            if (counter > 192)
            {
                Log("step 192 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 193 start");
            var value193 = system.GetAsset("Asset193");
            counter = counter + 193;
            if (counter > 193)
            {
                Log("step 193 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 194 start");
            var value194 = system.GetAsset("Asset194");
            counter = counter + 194;
            if (counter > 194)
            {
                Log("step 194 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 195 start");
            var value195 = system.GetAsset("Asset195");
            counter = counter + 195;
            if (counter > 195)
            {
                Log("step 195 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 196 start");
            var value196 = system.GetAsset("Asset196");
            counter = counter + 196;
            if (counter > 196)
            {
                Log("step 196 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 197 start");
            var value197 = system.GetAsset("Asset197");
            counter = counter + 197;
            if (counter > 197)
            {
                Log("step 197 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 198 start");
            var value198 = system.GetAsset("Asset198");
            counter = counter + 198;
            if (counter > 198)
            {
                Log("step 198 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 199 start");
            var value199 = system.GetAsset("Asset199");
            counter = counter + 199;
            if (counter > 199)
            {
                Log("step 199 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 200 start");
            var value200 = system.GetAsset("Asset200");
            counter = counter + 200;
            if (counter > 200)
            {
                Log("step 200 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 201 start");
            var value201 = system.GetAsset("Asset201");
            counter = counter + 201;
            if (counter > 201)
            {
                Log("step 201 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 202 start");
            var value202 = system.GetAsset("Asset202");
            counter = counter + 202;
            if (counter > 202)
            {
                Log("step 202 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 203 start");
            var value203 = system.GetAsset("Asset203");
            counter = counter + 203;
            if (counter > 203)
            {
                Log("step 203 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 204 start");
            var value204 = system.GetAsset("Asset204");
            counter = counter + 204;
            if (counter > 204)
            {
                Log("step 204 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 205 start");
            var value205 = system.GetAsset("Asset205");
            counter = counter + 205;
            if (counter > 205)
            {
                Log("step 205 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 206 start");
            var value206 = system.GetAsset("Asset206");
            counter = counter + 206;
            if (counter > 206)
            {
                Log("step 206 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 207 start");
            var value207 = system.GetAsset("Asset207");
            counter = counter + 207;
            if (counter > 207)
            {
                Log("step 207 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 208 start");
            var value208 = system.GetAsset("Asset208");
            counter = counter + 208;
            if (counter > 208)
            {
                Log("step 208 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 209 start");
            var value209 = system.GetAsset("Asset209");
            counter = counter + 209;
            if (counter > 209)
            {
                Log("step 209 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 210 start");
            var value210 = system.GetAsset("Asset210");
            counter = counter + 210;
            if (counter > 210)
            {
                Log("step 210 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 211 start");
            var value211 = system.GetAsset("Asset211");
            counter = counter + 211;
            if (counter > 211)
            {
                Log("step 211 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 212 start");
            var value212 = system.GetAsset("Asset212");
            counter = counter + 212;
            if (counter > 212)
            {
                Log("step 212 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 213 start");
            var value213 = system.GetAsset("Asset213");
            counter = counter + 213;
            if (counter > 213)
            {
                Log("step 213 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 214 start");
            var value214 = system.GetAsset("Asset214");
            counter = counter + 214;
            if (counter > 214)
            {
                Log("step 214 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 215 start");
            var value215 = system.GetAsset("Asset215");
            counter = counter + 215;
            if (counter > 215)
            {
                Log("step 215 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 216 start");
            var value216 = system.GetAsset("Asset216");
            counter = counter + 216;
            if (counter > 216)
            {
                Log("step 216 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 217 start");
            var value217 = system.GetAsset("Asset217");
            counter = counter + 217;
            if (counter > 217)
            {
                Log("step 217 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 218 start");
            var value218 = system.GetAsset("Asset218");
            counter = counter + 218;
            if (counter > 218)
            {
                Log("step 218 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 219 start");
            var value219 = system.GetAsset("Asset219");
            counter = counter + 219;
            if (counter > 219)
            {
                Log("step 219 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 220 start");
            var value220 = system.GetAsset("Asset220");
            counter = counter + 220;
            if (counter > 220)
            {
                Log("step 220 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 221 start");
            var value221 = system.GetAsset("Asset221");
            counter = counter + 221;
            if (counter > 221)
            {
                Log("step 221 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 222 start");
            var value222 = system.GetAsset("Asset222");
            counter = counter + 222;
            if (counter > 222)
            {
                Log("step 222 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 223 start");
            var value223 = system.GetAsset("Asset223");
            counter = counter + 223;
            if (counter > 223)
            {
                Log("step 223 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 224 start");
            var value224 = system.GetAsset("Asset224");
            counter = counter + 224;
            if (counter > 224)
            {
                Log("step 224 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 225 start");
            var value225 = system.GetAsset("Asset225");
            counter = counter + 225;
            if (counter > 225)
            {
                Log("step 225 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 226 start");
            var value226 = system.GetAsset("Asset226");
            counter = counter + 226;
            if (counter > 226)
            {
                Log("step 226 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 227 start");
            var value227 = system.GetAsset("Asset227");
            counter = counter + 227;
            if (counter > 227)
            {
                Log("step 227 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 228 start");
            var value228 = system.GetAsset("Asset228");
            counter = counter + 228;
            if (counter > 228)
            {
                Log("step 228 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 229 start");
            var value229 = system.GetAsset("Asset229");
            counter = counter + 229;
            if (counter > 229)
            {
                Log("step 229 hot");
                counter = counter - 1;
            }
            total = total + counter;
            Log("step 230 start");
            var value230 = system.GetAsset("Asset230");
            counter = counter + 230;
            if (counter > 230)
            {
                Log("step 230 hot");
                counter = counter - 1;
            }
            total = total + counter;
        }
    }
}
